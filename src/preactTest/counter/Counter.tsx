import {h} from 'preact';
import {useCallback, useState} from 'preact/hooks';

export interface CounterProps {
	start: number;
}

export const Counter = ({start}: CounterProps) => {
	const [value, setValue] = useState(start);
	const increment = useCallback(() => {
		setValue(value + 1);
	}, [value]);

	return (
		<div>
			Counter: {value}
			<button onClick={increment}>Increment</button>
		</div>
	);
}
