import { gensvg } from './gensvg'
import { startSimulation } from './physics'
import { GITHUB_ID, TEXT } from './utils'
import pageApp from './web/index.html'

Bun.serve({
  port: 3000,
  development: {
    hmr: true,
    console: true
  },
  routes: {
    '/': pageApp,
    '/trajectory': async () => {
      return Response.json(
        await startSimulation({
          username: GITHUB_ID,
          text: TEXT,
          sampleRate: 8
        })
      )
    },
    '/svg': async () => {
      const svg = await gensvg({
        username: GITHUB_ID,
        text: TEXT,
        sampleRate: 8
      })
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' }
      })
    }
  }
})

console.log('http://localhost:3000/')
