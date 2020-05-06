import {h, render} from 'preact';
import App from './preactTest/PreactTest';

render(h(App,{a: 'a', b: 'b', start: 5}), document.body);
