import { Field } from "./field";

export interface Source {
	privacy: string | null;
	sensitive: boolean | null;
	language: string | null;
	note: string;
	fields: Field[];
}
