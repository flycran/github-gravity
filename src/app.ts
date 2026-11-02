import pageApp from './web/index.html'
import rapierPageApp from './web/rapier/index.html'

Bun.serve({
  port: 3000,
  development: {
    hmr: true,
    console: true
  },
  routes: {
    '/': pageApp,
    '/rapier': rapierPageApp
  }
})

console.log('http://localhost:3000/')
