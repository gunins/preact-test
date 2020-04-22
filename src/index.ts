import App from './preactTest/PreactTest';
import render from 'preact-render-to-string';

console.log(render(App({a: 'a', b: 'b', start: 5})));
