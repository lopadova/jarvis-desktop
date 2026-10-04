/** Debug helper: prints the tail of the Home conversation. Usage: node scripts/e2e-app/show-chat.mjs */
import { connect, conversation, pageFor } from './lib.mjs';

const b = await connect();
const home = await pageFor(b, 'home');
console.log((await conversation(home)).slice(-900));
await b.close();
