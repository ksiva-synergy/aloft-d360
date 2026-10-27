/**
 * FOER constants that browser code needs. Keep this file free of imports: `lib/foer/topics.ts` pulls in the database
 * client, and importing a constant from it would put Prisma's browser stub into the client bundle.
 */
export const ALL_KNOWLEDGE_KEY = 'all_knowledge';
