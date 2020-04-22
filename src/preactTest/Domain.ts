export interface Props {
	a: string;
	b: string;
	start: number;
}

export const domain = ({a, b}: Props): string => a + b;
