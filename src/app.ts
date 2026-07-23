import { gensvg } from './gensvg'
import { startSimulation } from './server/physics'
import { GITHUB_ID, TEXT } from './utils'
import pageApp from './web/index.html'

const res = await startSimulation(GITHUB_ID, TEXT)

Bun.serve({
  port: 3000,
  development: {
    hmr: true,
    console: true
  },
  routes: {
    '/': pageApp,
    '/trajectory': async () => {
      return Response.json(res)
    },
    '/svg': async () => {
      const svg = await gensvg({ username: GITHUB_ID, text: TEXT })
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' }
      })
    },
    '/assets/ARIAL.ttf': Bun.file('src/assets/ARIAL.ttf')
  }
})

console.log('http://localhost:3000/')
