import {h} from 'preact';
import {Props} from './Domain';
import {Counter} from './counter/Counter';


export default ({a, b, start}: Props) => (<div className="mdp-preact">
	<div className="mdp-preact-body">
		Preact Body {a}, {b}
		<Counter start={start}/>
	</div>
</div>);
