const typescript = require('rollup-plugin-typescript')
const commonjs   = require('rollup-plugin-commonjs')
const resolve    = require('@rollup/plugin-node-resolve')
const includePaths = require('rollup-plugin-includepaths');

const extensions = ['.js', '.mjs', 'jsx', 'ts', 'tsx']

export default {
	input:    'src/index.ts',
	output:   {
		name:   'app',
		file:   'dist/index.js',
		format: 'iife'
	},
	external: [],
	plugins:  [
		resolve(),
		commonjs({
			extensions
		}),
		typescript({ jsx:                 'react',
			jsxFactory:                   'h',
			target:                       'esnext',
			allowSyntheticDefaultImports: true
		})
	]
}
