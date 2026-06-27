import { db } from '@/lib/db';
import { contentGenerations } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';

const ids = ['qgen-mq529m74','qgen-mq529sg9','qgen-mq529ylj'];
const rows = await db.query.contentGenerations.findMany({ where: inArray(contentGenerations.id, ids) });
for (const r of rows) {
  console.log('=== ' + r.id + ' ===');
  console.log('createdAt:', (r.createdAt as unknown as Date)?.toISOString?.() ?? r.createdAt);
  console.log('topic:', r.topic);
  console.log('contentProfileKey:', r.contentProfileKey);
  console.log('imagesStatus:', r.imagesStatus);
  console.log('imagePaths:', JSON.stringify(r.imagePaths));
  console.log('promptVersions:', JSON.stringify(r.promptVersions, null, 2));
  console.log('');
}
process.exit(0);
