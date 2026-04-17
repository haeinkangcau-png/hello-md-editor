const { Resvg } = require('@resvg/resvg-js')
const fs = require('fs')
const path = require('path')

const svgPath = path.join(__dirname, '../build/icon.svg')
const outPath = path.join(__dirname, '../build/icon.png')

const svg = fs.readFileSync(svgPath, 'utf8')
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 512 },
  background: 'rgba(0,0,0,0)',
})
const rendered = resvg.render()
const png = rendered.asPng()
fs.writeFileSync(outPath, png)
console.log(`icon.png generated (${png.length} bytes)`)
