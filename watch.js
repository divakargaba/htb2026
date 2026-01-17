// Simple watcher that logs when files change
// Note: You still need to manually reload the extension in Chrome
// This just alerts you when files have changed

const chokidar = require('chokidar')
const path = require('path')

const extensionDir = path.join(__dirname, 'extension')

console.log('👀 Watching extension folder for changes...')
console.log('📁', extensionDir)
console.log('')
console.log('When files change:')
console.log('  1. Go to chrome://extensions')
console.log('  2. Click the reload ⟳ button on your extension')
console.log('  3. Refresh your YouTube tab')
console.log('')

const watcher = chokidar.watch(extensionDir, {
  ignored: /node_modules/,
  persistent: true
})

watcher.on('change', (filePath) => {
  const relative = path.relative(extensionDir, filePath)
  console.log(`\n✏️  Changed: ${relative}`)
  console.log('   → Reload extension in chrome://extensions')
})

watcher.on('add', (filePath) => {
  const relative = path.relative(extensionDir, filePath)
  console.log(`\n➕ Added: ${relative}`)
})

console.log('Ready! Make changes to extension files...\n')
