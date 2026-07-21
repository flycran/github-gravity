import PageApp from './src/index.html'

Bun.serve({
  development: {
    hmr: true,
    console: true
  },
  routes: {
    '/': PageApp
  },
  port: 3000
})

console.log('🚀 Server running at http://localhost:3000')
