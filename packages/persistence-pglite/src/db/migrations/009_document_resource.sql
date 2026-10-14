-- The node a document was created with, beside the row. The server fences a
-- body through the resource that owns it, and the device that creates the
-- document names that resource once, when it first registers the document.
-- The pair is written together at creation, so the name is the creation's own
-- fact — not something looked up later among whatever nodes point at the
-- document, which anyone who knows its id can add to. A document the graph
-- brought in has none: it was not created here.
alter table document add column resource_id text;
