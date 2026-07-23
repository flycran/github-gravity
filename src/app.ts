import { gensvg } from './gensvg'
import { startSimulation } from './server/physics'
import { TEXT } from './utils'
import pageApp from './web/index.html'

const res = await startSimulation('yyx990803')

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
      const svg = await gensvg({ name: 'Platane' })
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' }
      })
    },
    '/assets/ARIAL.ttf': Bun.file('src/assets/ARIAL.ttf')
  }
})

console.log('http://localhost:3000/')
