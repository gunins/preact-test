const typescript = require('rollup-plugin-typescript')
const commonjs   = require('rollup-plugin-commonjs')
const resolve    = require('@rollup/plugin-node-resolve')
const includePaths = require('rollup-plugin-includepaths');

const extensions = ['.js', '.mjs', 'jsx', 'ts', 'tsx']

const include = {
	'preact-render-to-string': './node_modules/preact-render-to-string/src/index',
	'preact':       './node_modules/preact/src/index',
	'preact/hooks': './node_modules/preact/hooks/src/index'
}
export default {
	input:    'src/index.ts',
	output:   {
		name:   'app',
		file:   'dist/index.js',
		format: 'iife'
	},
	external: [],
	plugins:  [
		includePaths({
			include,
			extensions
		}),
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
