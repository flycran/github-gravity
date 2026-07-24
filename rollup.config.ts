// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import copy from 'rollup-plugin-copy'

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    typescript({
      tsconfig: 'tsconfig.bun.json',
      compilerOptions: { composite: false }
    }),
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    copy({
      targets: [{ src: 'src/assets/*', dest: 'dist/assets' }]
    })
  ]
}

export default config
