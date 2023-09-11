import { Account } from "./account";
import { Status } from "./status";
import { Tag } from "./tag";

export interface Results {
	accounts: Account[];
	statuses: Status[];
	hashtags: Tag[];
}
