-- Several parser proxies instead of one (parser/connection/). New table only.
CREATE TABLE "ParserProxy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParserProxy_pkey" PRIMARY KEY ("id")
);

-- The single proxy entered since 20261111120000 becomes the first one in the
-- list. Its ParserSetting row stays: the previous release still reads it.
INSERT INTO "ParserProxy" ("id", "name", "url", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Прокси 1', "value", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ParserSetting"
WHERE "key" = 'parser.proxyUrl' AND "value" <> '';
