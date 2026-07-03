import AppKit
import Foundation
import WebKit

private let imageExtensions = Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"])

private enum NativeLog {
  static let url: URL = {
    let dir = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library")
      .appendingPathComponent("Logs")
      .appendingPathComponent("HiMDPower")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("launch.log")
  }()

  static func write(_ message: String) {
    let line = "[\(Date())] \(message)\n"
    guard let data = line.data(using: .utf8) else { return }
    if FileManager.default.fileExists(atPath: url.path),
       let handle = try? FileHandle(forWritingTo: url) {
      defer { try? handle.close() }
      _ = try? handle.seekToEnd()
      _ = try? handle.write(contentsOf: data)
    } else {
      try? data.write(to: url)
    }
  }
}

private func mimeType(for path: String) -> String {
  switch URL(fileURLWithPath: path).pathExtension.lowercased() {
  case "png": return "image/png"
  case "jpg", "jpeg": return "image/jpeg"
  case "gif": return "image/gif"
  case "webp": return "image/webp"
  case "bmp": return "image/bmp"
  case "svg": return "image/svg+xml"
  case "html", "htm": return "text/html"
  case "js", "mjs": return "text/javascript"
  case "css": return "text/css"
  case "json", "map": return "application/json"
  case "txt": return "text/plain"
  case "md": return "text/markdown"
  default: return "application/octet-stream"
  }
}

private func jsonLiteral(_ value: Any) -> String {
  let wrapped = [value]
  guard JSONSerialization.isValidJSONObject(wrapped),
        let data = try? JSONSerialization.data(withJSONObject: wrapped, options: []),
        var string = String(data: data, encoding: .utf8) else {
    return "null"
  }
  string.removeFirst()
  string.removeLast()
  return string
}

private func resolvedPath(_ path: String) -> String {
  NSString(string: path).expandingTildeInPath
}

private final class LocalImageSchemeHandler: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(NSError(domain: "HiMDPower", code: 400))
      return
    }

    let filePath = url.path.removingPercentEncoding ?? url.path
    do {
      let data = try Data(contentsOf: URL(fileURLWithPath: filePath))
      let response = URLResponse(
        url: url,
        mimeType: mimeType(for: filePath),
        expectedContentLength: data.count,
        textEncodingName: nil
      )
      urlSchemeTask.didReceive(response)
      urlSchemeTask.didReceive(data)
      urlSchemeTask.didFinish()
    } catch {
      urlSchemeTask.didFailWithError(error)
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

private final class AppBundleSchemeHandler: NSObject, WKURLSchemeHandler {
  private let distURL: URL

  init(distURL: URL) {
    self.distURL = distURL.standardizedFileURL
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(NSError(domain: "HiMDPower", code: 400))
      return
    }

    let rawPath = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
    let decodedPath = rawPath.removingPercentEncoding ?? rawPath
    let relativePath = decodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let fileURL = distURL.appendingPathComponent(relativePath).standardizedFileURL
    NativeLog.write("Bundle request: \(url.absoluteString) -> \(fileURL.lastPathComponent)")

    guard fileURL.path.hasPrefix(distURL.path + "/") || fileURL.path == distURL.path else {
      urlSchemeTask.didFailWithError(NSError(domain: "HiMDPower", code: 403))
      return
    }

    do {
      let data = try Data(contentsOf: fileURL)
      let response = HTTPURLResponse(
        url: url,
        statusCode: 200,
        httpVersion: "HTTP/1.1",
        headerFields: [
          "Content-Type": mimeType(for: fileURL.path),
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*"
        ]
      ) ?? URLResponse(
        url: url,
        mimeType: mimeType(for: fileURL.path),
        expectedContentLength: data.count,
        textEncodingName: "utf-8"
      )
      urlSchemeTask.didReceive(response)
      urlSchemeTask.didReceive(data)
      urlSchemeTask.didFinish()
    } catch {
      NativeLog.write("Bundle asset failed: \(url.absoluteString) -> \(fileURL.path): \(error.localizedDescription)")
      urlSchemeTask.didFailWithError(error)
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

private final class ConsoleLogHandler: NSObject, WKScriptMessageHandler {
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if let body = message.body as? [String: Any] {
      let level = body["level"] as? String ?? "log"
      let text = body["message"] as? String ?? "\(body)"
      NativeLog.write("JS \(level): \(text)")
    } else {
      NativeLog.write("JS log: \(message.body)")
    }
  }
}

private final class DroppableWebView: WKWebView {
  var onFileDropped: ((String) -> Void)?

  override init(frame: NSRect, configuration: WKWebViewConfiguration) {
    super.init(frame: frame, configuration: configuration)
    registerForDraggedTypes([.fileURL])
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    registerForDraggedTypes([.fileURL])
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    let url = acceptedFileURL(from: sender)
    NativeLog.write("draggingEntered: \(url?.path ?? "no accepted file")")
    return url == nil ? [] : .copy
  }

  override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
    acceptedFileURL(from: sender) == nil ? [] : .copy
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    guard let url = acceptedFileURL(from: sender) else { return false }
    NativeLog.write("Dropped file: \(url.path)")
    onFileDropped?(url.path)
    return true
  }

  private func acceptedFileURL(from sender: NSDraggingInfo) -> URL? {
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
    return urls.first { url in
      let ext = url.pathExtension.lowercased()
      return ext == "md" || ext == "html" || ext == "htm"
    }
  }
}

private let diagnosticsScript = """
(() => {
  function send(level, args) {
    try {
      window.webkit.messageHandlers.nativeConsole.postMessage({
        level,
        message: Array.from(args).map(v => {
          if (v instanceof Error) return v.stack || v.message;
          if (typeof v === 'string') return v;
          try { return JSON.stringify(v); } catch { return String(v); }
        }).join(' ')
      });
    } catch {}
  }

  ['log', 'info', 'warn', 'error'].forEach(level => {
    const original = console[level]?.bind(console);
    console[level] = (...args) => {
      send(level, args);
      if (original) original(...args);
    };
  });

  window.addEventListener('error', event => {
    send('error', [event.message + ' @ ' + event.filename + ':' + event.lineno + ':' + event.colno]);
  });

  window.addEventListener('unhandledrejection', event => {
    send('error', ['Unhandled rejection', event.reason]);
  });

  const benchStart = performance.now();
  function pollRootReady() {
    const root = document.getElementById('root');
    if (root && root.childElementCount > 0) {
      send('bench', ['root-ready-ms', (performance.now() - benchStart).toFixed(1)]);
      return;
    }
    requestAnimationFrame(pollRootReady);
  }
  requestAnimationFrame(pollRootReady);
})();
"""

private let bridgeScript = """
(() => {
  if (window.electronAPI) return;

  const callbacks = new Map();
  let nextId = 1;

  function invoke(channel, ...args) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      callbacks.set(id, { resolve, reject });
      window.webkit.messageHandlers.nativeAPI.postMessage({ id, channel, args });
    });
  }

  window.__hiMdNativeResolve = (id, ok, payload) => {
    const cb = callbacks.get(id);
    if (!cb) return;
    callbacks.delete(id);
    if (ok) {
      cb.resolve(payload);
    } else {
      const message = payload && payload.message ? payload.message : String(payload || 'Native bridge error');
      cb.reject(new Error(message));
    }
  };

  window.electronAPI = {
    listFiles: dir => invoke('list-files', dir),
    readFile: path => invoke('read-file', path),
    writeFile: (path, content) => invoke('write-file', path, content),
    checkExists: path => invoke('check-exists', path),
    openFolder: () => invoke('open-folder'),
    saveDialog: defaultPath => invoke('save-dialog', defaultPath),
    revealInExplorer: filePath => invoke('reveal-in-explorer', filePath),
    openPath: target => invoke('open-path', target),
    createFolder: dirPath => invoke('create-folder', dirPath),
    renameFile: (oldPath, newPath) => invoke('rename-file', oldPath, newPath),
    saveImage: (dir, name, b64) => invoke('save-image', dir, name, b64),
    cleanupImages: (dir, refs) => invoke('cleanup-images', dir, refs),
    copyAssets: (src, dest) => invoke('copy-assets', src, dest),
    readImageBase64: filePath => invoke('read-image-base64', filePath),
    getOpenFilePath: () => invoke('get-open-file-path'),
    openNewWindow: () => invoke('open-new-window'),
    openScheduleWindow: (content, fileName) => invoke('open-schedule-window', content, fileName),
    openSpecWindow: (content, fileName) => invoke('open-spec-window', content, fileName),
    onOpenFile: cb => {
      window.__hiMdNativeOpenFileCallback = cb;
      return () => {
        if (window.__hiMdNativeOpenFileCallback === cb) window.__hiMdNativeOpenFileCallback = null;
      };
    }
  };
})();
"""

private final class NativeBridge: NSObject, WKScriptMessageHandler {
  weak var app: AppController?
  weak var webView: WKWebView?
  private let pendingOpenPath: String?

  init(app: AppController, pendingOpenPath: String?) {
    self.app = app
    self.pendingOpenPath = pendingOpenPath
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let id = (body["id"] as? NSNumber)?.intValue,
          let channel = body["channel"] as? String else {
      return
    }

    let args = body["args"] as? [Any] ?? []
    do {
      let result = try handle(channel: channel, args: args)
      respond(id: id, ok: true, payload: result)
    } catch {
      respond(id: id, ok: false, payload: ["message": error.localizedDescription])
    }
  }

  private func respond(id: Int, ok: Bool, payload: Any) {
    let script = "window.__hiMdNativeResolve(\(id), \(ok ? "true" : "false"), \(jsonLiteral(payload)));"
    webView?.evaluateJavaScript(script) { _, error in
      if let error {
        NativeLog.write("Bridge response failed: \(error.localizedDescription)")
      }
    }
  }

  private func handle(channel: String, args: [Any]) throws -> Any {
    switch channel {
    case "list-files":
      return try listFiles(args.first as? String)
    case "read-file":
      return try readFile(args.first as? String)
    case "write-file":
      return try writeFile(path: args.first as? String, content: args.dropFirst().first as? String)
    case "check-exists":
      guard let path = args.first as? String else { return false }
      return FileManager.default.fileExists(atPath: resolvedPath(path))
    case "open-folder":
      return openFolder()
    case "save-dialog":
      return saveDialog(args.first as? String)
    case "reveal-in-explorer":
      return revealInExplorer(args.first as? String)
    case "open-path":
      return openPath(args.first as? String)
    case "create-folder":
      return try createFolder(args.first as? String)
    case "rename-file":
      return try renameFile(oldPath: args.first as? String, newPath: args.dropFirst().first as? String)
    case "save-image":
      return try saveImage(dirPath: args.first as? String, fileName: args.dropFirst().first as? String, base64: args.dropFirst(2).first as? String)
    case "cleanup-images":
      return try cleanupImages(dirPath: args.first as? String, refs: args.dropFirst().first as? [String])
    case "copy-assets":
      return try copyAssets(src: args.first as? String, dest: args.dropFirst().first as? String)
    case "read-image-base64":
      return try readImageBase64(args.first as? String)
    case "get-open-file-path":
      return pendingOpenPath ?? NSNull()
    case "open-new-window":
      app?.openMainWindow(pendingOpenPath: nil)
      return NSNull()
    case "open-schedule-window":
      app?.openScheduleWindow(content: args.first as? String, fileName: args.dropFirst().first as? String)
      return NSNull()
    case "open-spec-window":
      app?.openPage("specviewer.html", title: "UX Spec Viewer")
      return NSNull()
    default:
      throw NSError(domain: "HiMDPower", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unsupported native channel: \(channel)"])
    }
  }

  private func listFiles(_ rawPath: String?) throws -> Any {
    guard let rawPath else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing directory path"])
    }

    let url = URL(fileURLWithPath: resolvedPath(rawPath)).standardizedFileURL
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
      throw NSError(domain: "HiMDPower", code: 404, userInfo: [NSLocalizedDescriptionKey: "디렉토리를 찾을 수 없습니다"])
    }

    let urls = try FileManager.default.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: []
    )

    let items: [[String: Any]] = urls.compactMap { itemURL in
      let name = itemURL.lastPathComponent
      let isDir = ((try? itemURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false)

      if isDir, name.hasSuffix(".assets") { return nil }
      if !isDir {
        let ext = itemURL.pathExtension.lowercased()
        guard ext == "md" || ext == "html" || ext == "htm" else { return nil }
      }

      return ["name": name, "path": itemURL.path, "isDirectory": isDir]
    }.sorted { a, b in
      let aDir = a["isDirectory"] as? Bool ?? false
      let bDir = b["isDirectory"] as? Bool ?? false
      if aDir != bDir { return aDir && !bDir }
      return (a["name"] as? String ?? "").localizedCaseInsensitiveCompare(b["name"] as? String ?? "") == .orderedAscending
    }

    return ["items": items, "dir": url.path]
  }

  private func readFile(_ rawPath: String?) throws -> Any {
    guard let rawPath else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing file path"])
    }

    let path = resolvedPath(rawPath)
    guard FileManager.default.fileExists(atPath: path) else {
      throw NSError(domain: "HiMDPower", code: 404, userInfo: [NSLocalizedDescriptionKey: "파일을 찾을 수 없습니다"])
    }

    return ["content": try String(contentsOfFile: path, encoding: .utf8), "path": path]
  }

  private func writeFile(path rawPath: String?, content: String?) throws -> Any {
    guard let rawPath, let content else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing write arguments"])
    }

    let path = resolvedPath(rawPath)
    let dir = URL(fileURLWithPath: path).deletingLastPathComponent().path
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    try content.write(toFile: path, atomically: true, encoding: .utf8)
    return ["success": true, "path": path]
  }

  private func openFolder() -> Any {
    let panel = NSOpenPanel()
    panel.title = "폴더 열기"
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    return panel.runModal() == .OK ? (panel.url?.path ?? NSNull()) : NSNull()
  }

  private func saveDialog(_ defaultPath: String?) -> Any {
    let panel = NSSavePanel()
    panel.title = "다른 이름으로 저장"
    panel.allowedContentTypes = [.plainText]

    if let defaultPath, !defaultPath.isEmpty {
      let url = URL(fileURLWithPath: resolvedPath(defaultPath))
      panel.directoryURL = url.deletingLastPathComponent()
      panel.nameFieldStringValue = url.lastPathComponent
    } else {
      panel.nameFieldStringValue = "untitled.md"
    }

    return panel.runModal() == .OK ? (panel.url?.path ?? NSNull()) : NSNull()
  }

  private func revealInExplorer(_ rawPath: String?) -> Any {
    guard let rawPath else { return ["success": false, "error": "empty path"] }
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: resolvedPath(rawPath))])
    return ["success": true]
  }

  private func openPath(_ rawTarget: String?) -> Any {
    guard let rawTarget, !rawTarget.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return ["success": false, "error": "empty path"]
    }

    let trimmed = rawTarget.trimmingCharacters(in: .whitespacesAndNewlines)
    let url: URL
    if let parsed = URL(string: trimmed), parsed.isFileURL {
      url = parsed
    } else {
      url = URL(fileURLWithPath: resolvedPath(trimmed))
    }

    let ok = NSWorkspace.shared.open(url)
    return ok ? (["success": true] as [String: Any]) : (["success": false, "error": "open failed"] as [String: Any])
  }

  private func createFolder(_ rawPath: String?) throws -> Any {
    guard let rawPath else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing directory path"])
    }

    let path = resolvedPath(rawPath)
    try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
    return ["success": true, "path": path]
  }

  private func renameFile(oldPath rawOldPath: String?, newPath rawNewPath: String?) throws -> Any {
    guard let rawOldPath, let rawNewPath else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing rename arguments"])
    }

    let oldPath = resolvedPath(rawOldPath)
    let newPath = resolvedPath(rawNewPath)
    guard FileManager.default.fileExists(atPath: oldPath) else {
      throw NSError(domain: "HiMDPower", code: 404, userInfo: [NSLocalizedDescriptionKey: "파일을 찾을 수 없습니다"])
    }
    guard !FileManager.default.fileExists(atPath: newPath) else {
      throw NSError(domain: "HiMDPower", code: 409, userInfo: [NSLocalizedDescriptionKey: "같은 이름의 파일이 이미 존재합니다"])
    }

    try FileManager.default.moveItem(atPath: oldPath, toPath: newPath)
    return ["success": true, "oldPath": oldPath, "newPath": newPath]
  }

  private func saveImage(dirPath rawDirPath: String?, fileName: String?, base64: String?) throws -> Any {
    guard let rawDirPath, let fileName, let base64, let data = Data(base64Encoded: base64) else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing image save arguments"])
    }

    let dirPath = resolvedPath(rawDirPath)
    try FileManager.default.createDirectory(atPath: dirPath, withIntermediateDirectories: true)
    let filePath = URL(fileURLWithPath: dirPath).appendingPathComponent(fileName).path
    try data.write(to: URL(fileURLWithPath: filePath))
    return ["success": true, "path": filePath]
  }

  private func cleanupImages(dirPath rawDirPath: String?, refs: [String]?) throws -> Any {
    guard let rawDirPath else { return ["deleted": []] }

    let dirPath = resolvedPath(rawDirPath)
    guard FileManager.default.fileExists(atPath: dirPath) else { return ["deleted": []] }

    let refSet = Set(refs ?? [])
    let files = try FileManager.default.contentsOfDirectory(atPath: dirPath)
    var deleted: [String] = []

    for file in files {
      let ext = URL(fileURLWithPath: file).pathExtension.lowercased()
      guard imageExtensions.contains(ext), !refSet.contains(file) else { continue }
      try FileManager.default.removeItem(atPath: URL(fileURLWithPath: dirPath).appendingPathComponent(file).path)
      deleted.append(file)
    }

    if (try? FileManager.default.contentsOfDirectory(atPath: dirPath).isEmpty) == true {
      try FileManager.default.removeItem(atPath: dirPath)
    }

    return ["deleted": deleted]
  }

  private func copyAssets(src rawSrc: String?, dest rawDest: String?) throws -> Any {
    guard let rawSrc, let rawDest else {
      throw NSError(domain: "HiMDPower", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing copy arguments"])
    }

    let src = URL(fileURLWithPath: resolvedPath(rawSrc))
    let dest = URL(fileURLWithPath: resolvedPath(rawDest))
    guard FileManager.default.fileExists(atPath: src.path) else {
      throw NSError(domain: "HiMDPower", code: 404, userInfo: [NSLocalizedDescriptionKey: "원본 폴더를 찾을 수 없습니다"])
    }

    if FileManager.default.fileExists(atPath: dest.path) {
      try FileManager.default.removeItem(at: dest)
    }
    try FileManager.default.copyItem(at: src, to: dest)
    return ["success": true]
  }

  private func readImageBase64(_ rawPath: String?) throws -> Any {
    guard let rawPath else { return NSNull() }

    let path = resolvedPath(rawPath)
    guard FileManager.default.fileExists(atPath: path) else { return NSNull() }

    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    return "data:\(mimeType(for: path));base64,\(data.base64EncodedString())"
  }
}

private final class NativeWindow: NSObject, WKNavigationDelegate, NSWindowDelegate {
  let window: NSWindow
  let webView: DroppableWebView
  private let distURL: URL
  private let pageName: String
  private let afterLoad: ((WKWebView) -> Void)?
  private let nativeBridge: NativeBridge
  private let consoleLogHandler = ConsoleLogHandler()
  private var didLoadPage = false
  private var pageOpenStartedAt: Date?
  private var didLogRootReady = false
  private var queuedOpenFilePath: String?
  private var queuedBenchmarkPaths: [String]?

  init(app: AppController, distURL: URL, pageName: String, title: String, pendingOpenPath: String?, afterLoad: ((WKWebView) -> Void)? = nil) {
    self.distURL = distURL
    self.pageName = pageName
    self.afterLoad = afterLoad
    self.nativeBridge = NativeBridge(app: app, pendingOpenPath: pendingOpenPath)

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(AppBundleSchemeHandler(distURL: distURL), forURLScheme: "himd-app")
    config.setURLSchemeHandler(LocalImageSchemeHandler(), forURLScheme: "local-image")

    let userContentController = WKUserContentController()
    userContentController.addUserScript(WKUserScript(source: diagnosticsScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    userContentController.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    userContentController.add(nativeBridge, name: "nativeAPI")
    userContentController.add(consoleLogHandler, name: "nativeConsole")
    config.userContentController = userContentController

    webView = DroppableWebView(frame: .zero, configuration: config)
    nativeBridge.webView = webView

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = title
    window.minSize = NSSize(width: 900, height: 600)
    window.contentView = webView

    super.init()

    webView.navigationDelegate = self
    webView.onFileDropped = { [weak self] path in
      self?.openFile(path)
    }
    window.delegate = self
  }

  func show() {
    NativeLog.write("Opening page \(pageName) from \(distURL.path)")
    pageOpenStartedAt = Date()
    didLogRootReady = false
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    let url = URL(string: "himd-app://bundle/\(pageName)")!
    webView.load(URLRequest(url: url))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    didLoadPage = true
    NativeLog.write("Loaded page \(pageName)")
    pollRootReadyBenchmark()
    logPageState(webView, label: "didFinish")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self, weak webView] in
      guard let self, let webView else { return }
      self.logPageState(webView, label: "after 1s")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self, weak webView] in
      guard let self, let webView else { return }
      self.logPageState(webView, label: "after 3s")
    }
    afterLoad?(webView)
    if let queuedOpenFilePath {
      self.queuedOpenFilePath = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
        self?.openFile(queuedOpenFilePath)
      }
    }
    if let queuedBenchmarkPaths {
      self.queuedBenchmarkPaths = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
        self?.runFileBenchmark(queuedBenchmarkPaths)
      }
    }
  }

  private func logPageState(_ webView: WKWebView, label: String) {
    webView.evaluateJavaScript("""
    (() => ({
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      scriptCount: document.scripts.length,
      styleCount: document.styleSheets.length,
      rootExists: !!document.getElementById('root'),
      rootChildCount: document.getElementById('root')?.childElementCount ?? -1,
      rootText: (document.getElementById('root')?.innerText || '').slice(0, 200),
      bodyText: (document.body?.innerText || '').slice(0, 200),
      localStorageOK: (() => { try { localStorage.setItem('__himd_probe', '1'); localStorage.removeItem('__himd_probe'); return true; } catch (e) { return String(e && e.message || e); } })(),
      hasElectronAPI: !!window.electronAPI
    }))();
    """) { result, error in
      if let error {
        NativeLog.write("Page state \(label) failed: \(error.localizedDescription)")
      } else {
        NativeLog.write("Page state \(label): \(String(describing: result))")
      }
    }
  }

  private func pollRootReadyBenchmark(attempt: Int = 0) {
    guard !didLogRootReady else { return }

    webView.evaluateJavaScript("document.getElementById('root')?.childElementCount || 0") { [weak self] result, _ in
      guard let self, !self.didLogRootReady else { return }
      let count = (result as? NSNumber)?.intValue ?? 0

      if count > 0 {
        self.didLogRootReady = true
        let elapsed = self.pageOpenStartedAt.map { Date().timeIntervalSince($0) * 1000 } ?? 0
        NativeLog.write(String(format: "Native bench: root-ready-ms %.1f", elapsed))
      } else if attempt < 200 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
          self?.pollRootReadyBenchmark(attempt: attempt + 1)
        }
      } else {
        NativeLog.write("Native bench: root-ready-timeout")
      }
    }
  }

  func openFile(_ path: String) {
    guard didLoadPage else {
      queuedOpenFilePath = path
      return
    }

    let fileName = URL(fileURLWithPath: path).lastPathComponent
    let script = """
    (() => {
      if (typeof window.__hiMdNativeOpenFileCallback === 'function') {
        window.__hiMdNativeOpenFileCallback(\(jsonLiteral(path)));
        const expectedTitle = \(jsonLiteral(fileName + " — Hi MD Editor"));
        const started = performance.now();
        const poll = () => {
          if (document.title === expectedTitle) {
            console.info('bench:file-ready-ms', \(jsonLiteral(fileName)), (performance.now() - started).toFixed(1));
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
        return true;
      }
      return false;
    })();
    """
    webView.evaluateJavaScript(script) { result, error in
      if let error {
        NativeLog.write("Drop open-file callback failed: \(error.localizedDescription)")
      } else if let opened = result as? Bool, opened == false {
        NativeLog.write("Open-file callback was not ready; queued retry")
        self.queuedOpenFilePath = path
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
          guard let self, self.queuedOpenFilePath == path else { return }
          self.queuedOpenFilePath = nil
          self.openFile(path)
        }
      } else {
        NativeLog.write("Open-file callback result: \(String(describing: result))")
      }
    }
  }

  func runFileBenchmark(_ paths: [String]) {
    guard didLoadPage else {
      queuedBenchmarkPaths = paths
      return
    }
    runFileBenchmark(paths, index: 0)
  }

  private func runFileBenchmark(_ paths: [String], index: Int) {
    guard index < paths.count else {
      webView.evaluateJavaScript("console.info('bench:file-sequence-complete', \(paths.count));")
      return
    }

    let path = paths[index]
    let fileName = URL(fileURLWithPath: path).lastPathComponent
    let script = """
    (() => {
      const path = \(jsonLiteral(path));
      if (typeof window.__hiMdNativeOpenFileCallback !== 'function') return false;
      window.__hiMdNativeOpenFileCallback(path);
      return true;
    })();
    """
    webView.evaluateJavaScript(script) { result, error in
      if let error {
        NativeLog.write("Benchmark file load failed for \(fileName): \(error.localizedDescription)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
          self?.runFileBenchmark(paths, index: index + 1)
        }
      } else if let opened = result as? Bool, opened {
        self.pollFileBenchmarkReady(fileName: fileName, paths: paths, index: index, startedAt: Date())
      } else {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
          self?.runFileBenchmark(paths, index: index)
        }
      }
    }
  }

  private func pollFileBenchmarkReady(fileName: String, paths: [String], index: Int, startedAt: Date, attempt: Int = 0) {
    let expectedTitle = "\(fileName) — Hi MD Editor"
    webView.evaluateJavaScript("document.title") { [weak self] result, _ in
      guard let self else { return }

      if (result as? String) == expectedTitle {
        let elapsed = Date().timeIntervalSince(startedAt) * 1000
        NativeLog.write(String(format: "Native bench:file-ready-ms %@ %.1f", fileName, elapsed))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
          self?.runFileBenchmark(paths, index: index + 1)
        }
      } else if attempt < 200 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
          self?.pollFileBenchmarkReady(fileName: fileName, paths: paths, index: index, startedAt: startedAt, attempt: attempt + 1)
        }
      } else {
        NativeLog.write("Benchmark file load timed out for \(fileName)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
          self?.runFileBenchmark(paths, index: index + 1)
        }
      }
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    NativeLog.write("Navigation failed for \(pageName): \(error.localizedDescription)")
    showLoadError(error)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    NativeLog.write("Provisional navigation failed for \(pageName): \(error.localizedDescription)")
    showLoadError(error)
  }

  private func showLoadError(_ error: Error) {
    let alert = NSAlert()
    alert.messageText = "Hi MD Power 화면을 열 수 없습니다."
    alert.informativeText = "\(error.localizedDescription)\n\nLog: \(NativeLog.url.path)"
    alert.runModal()
  }
}

private struct LaunchOptions {
  let distURL: URL
  let openFilePath: String?

  static func parse() -> LaunchOptions {
    var distPath: String?
    var openFilePath: String?
    var args = Array(CommandLine.arguments.dropFirst())

    while !args.isEmpty {
      let arg = args.removeFirst()
      if arg == "--dist", !args.isEmpty {
        distPath = args.removeFirst()
      } else if openFilePath == nil {
        openFilePath = arg
      }
    }

    let fm = FileManager.default
    if let distPath {
      return LaunchOptions(distURL: URL(fileURLWithPath: distPath).standardizedFileURL, openFilePath: openFilePath)
    }

    if let resourceURL = Bundle.main.resourceURL?.appendingPathComponent("dist"),
       fm.fileExists(atPath: resourceURL.path) {
      return LaunchOptions(distURL: resourceURL.standardizedFileURL, openFilePath: openFilePath)
    }

    let cwdDist = URL(fileURLWithPath: fm.currentDirectoryPath).appendingPathComponent("dist")
    return LaunchOptions(distURL: cwdDist.standardizedFileURL, openFilePath: openFilePath)
  }
}

private final class AppController: NSObject, NSApplicationDelegate {
  private var windows: [NativeWindow] = []
  private var launchOptions: LaunchOptions?
  private var earlyOpenFilePath: String?
  private var benchmarkFilePaths: [String] = []

  func applicationDidFinishLaunching(_ notification: Notification) {
    NativeLog.write("Launch args: \(CommandLine.arguments.joined(separator: " "))")
    NativeLog.write("Bundle path: \(Bundle.main.bundlePath)")
    NSApp.setActivationPolicy(.regular)
    installMenu()

    let options = LaunchOptions.parse()
    launchOptions = options
    benchmarkFilePaths = loadBenchmarkFilePaths()
    NativeLog.write("dist path: \(options.distURL.path)")

    guard FileManager.default.fileExists(atPath: options.distURL.appendingPathComponent("index.html").path) else {
      NativeLog.write("Missing dist/index.html at \(options.distURL.path)")
      showMissingDistAlert(path: options.distURL.path)
      NSApp.terminate(nil)
      return
    }

    let mainWindow = openMainWindow(pendingOpenPath: earlyOpenFilePath ?? options.openFilePath)
    earlyOpenFilePath = nil
    if !benchmarkFilePaths.isEmpty {
      mainWindow?.runFileBenchmark(benchmarkFilePaths)
    }
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag {
      openMainWindow(pendingOpenPath: nil)
    }
    return true
  }

  func application(_ sender: NSApplication, openFile filename: String) -> Bool {
    openExternalFile(filename)
    return true
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    guard let url = urls.first(where: { isSupportedDocument($0.path) }) else { return }
    openExternalFile(url.path)
  }

  @discardableResult
  func openMainWindow(pendingOpenPath: String?) -> NativeWindow? {
    openPage("index.html", title: "Hi MD Power", pendingOpenPath: pendingOpenPath)
  }

  func openScheduleWindow(content: String?, fileName: String?) {
    openPage("schedule.html", title: "스케줄 뷰어") { webView in
      let contentLiteral = jsonLiteral(content ?? "")
      let fileLiteral = jsonLiteral(fileName ?? "스케줄")
      webView.evaluateJavaScript("""
      (() => {
        const el = document.getElementById('mdInput');
        if (el) el.value = \(contentLiteral);
        const h1 = document.querySelector('header h1');
        if (h1) h1.textContent = \(fileLiteral);
        if (typeof render === 'function') render(typeof currentMode !== 'undefined' ? currentMode : 'fit');
      })();
      """)
    }
  }

  @discardableResult
  func openPage(_ pageName: String, title: String, pendingOpenPath: String? = nil, afterLoad: ((WKWebView) -> Void)? = nil) -> NativeWindow? {
    guard let distURL = launchOptions?.distURL else {
      NativeLog.write("Cannot open \(pageName): launchOptions is nil")
      return nil
    }
    let nativeWindow = NativeWindow(
      app: self,
      distURL: distURL,
      pageName: pageName,
      title: title,
      pendingOpenPath: pendingOpenPath,
      afterLoad: afterLoad
    )
    windows.append(nativeWindow)
    nativeWindow.show()
    return nativeWindow
  }

  private func openExternalFile(_ path: String) {
    guard isSupportedDocument(path) else {
      NativeLog.write("Ignoring unsupported open file: \(path)")
      return
    }

    NativeLog.write("External open file: \(path)")
    guard launchOptions != nil else {
      earlyOpenFilePath = path
      NativeLog.write("Queued early open file: \(path)")
      return
    }

    if let window = windows.last {
      window.window.makeKeyAndOrderFront(nil)
      window.openFile(path)
    } else {
      openMainWindow(pendingOpenPath: path)
    }
  }

  private func isSupportedDocument(_ path: String) -> Bool {
    let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
    return ext == "md" || ext == "html" || ext == "htm"
  }

  private func loadBenchmarkFilePaths() -> [String] {
    guard let listPath = ProcessInfo.processInfo.environment["HIMD_BENCH_FILE_LIST"],
          !listPath.isEmpty,
          let content = try? String(contentsOfFile: listPath, encoding: .utf8) else {
      return []
    }

    let paths = content
      .split(separator: "\n")
      .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && isSupportedDocument($0) }

    NativeLog.write("Loaded benchmark file list: \(paths.count) files")
    return paths
  }

  private func installMenu() {
    let mainMenu = NSMenu()
    let appMenuItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Quit Hi MD Power", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)
    NSApp.mainMenu = mainMenu
  }

  private func showMissingDistAlert(path: String) {
    let alert = NSAlert()
    alert.messageText = "dist/index.html을 찾을 수 없습니다."
    alert.informativeText = "먼저 `npm run native:mac` 또는 `npx vite build`로 웹 번들을 생성하세요.\n\n찾은 경로: \(path)"
    alert.runModal()
  }
}

private let appController = AppController()
let app = NSApplication.shared
app.delegate = appController
app.run()
