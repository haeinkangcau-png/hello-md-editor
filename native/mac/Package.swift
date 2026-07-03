// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "HiMDPowerMac",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "HiMDPower", targets: ["HiMDPower"])
  ],
  targets: [
    .executableTarget(name: "HiMDPower")
  ]
)
