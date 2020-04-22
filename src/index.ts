import {h} from 'preact';
import App from './preactTest/PreactTest';
import render from 'preact-render-to-string';

console.log(render(h(App,{a: 'a', b: 'b', start: 5})));
