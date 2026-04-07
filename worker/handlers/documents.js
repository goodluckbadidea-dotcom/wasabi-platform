// ─── Document (R2) handlers ───

export async function handleGetDoc(env, id, jsonResponse) {
  try {
    // Get metadata from D1
    const meta = await env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(id).first();
    if (!meta) return jsonResponse({ _error: "Document not found" }, 404);

    // Get content from R2
    const r2Key = meta.r2_key || `docs/${id}.json`;
    const obj = await env.DOCS.get(r2Key);
    let content = { version: 1, blocks: [] };
    if (obj) {
      const text = await obj.text();
      content = JSON.parse(text);
    }

    return jsonResponse({
      id: meta.id,
      version: meta.version,
      word_count: meta.word_count,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      content,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleSaveDoc(env, id, body, jsonResponse) {
  const { content } = body;
  if (!content) return jsonResponse({ _error: "Missing content" }, 400);

  const r2Key = `docs/${id}.json`;

  try {
    // Calculate word count from blocks or plain string
    let wordCount = 0;
    if (typeof content === "string") {
      wordCount = content.split(/\s+/).filter(Boolean).length;
    } else if (content.blocks) {
      for (const block of content.blocks) {
        const text = block.content || "";
        wordCount += text.split(/\s+/).filter(Boolean).length;
      }
    }

    // Save content to R2
    await env.DOCS.put(r2Key, JSON.stringify(content), {
      httpMetadata: { contentType: "application/json" },
    });

    // Upsert D1 metadata
    await env.DB.prepare(
      `INSERT INTO documents (id, r2_key, version, word_count, created_at, updated_at)
       VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         version = documents.version + 1,
         word_count = excluded.word_count,
         updated_at = datetime('now')`
    ).bind(id, r2Key, wordCount).run();

    // Get updated metadata
    const meta = await env.DB.prepare("SELECT version, word_count FROM documents WHERE id = ?").bind(id).first();

    return jsonResponse({
      ok: true,
      id,
      version: meta?.version || 1,
      word_count: meta?.word_count || wordCount,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleUpdateDocBlocks(env, id, body, jsonResponse) {
  const { updates } = body;
  if (!updates || !Array.isArray(updates)) {
    return jsonResponse({ _error: "Missing updates array" }, 400);
  }

  const r2Key = `docs/${id}.json`;

  try {
    // Read current content
    const obj = await env.DOCS.get(r2Key);
    let content = { version: 1, blocks: [] };
    if (obj) {
      content = JSON.parse(await obj.text());
    }

    // Apply updates
    for (const update of updates) {
      const { action, block, blockId, index } = update;
      switch (action) {
        case "add":
          if (typeof index === "number") {
            content.blocks.splice(index, 0, block);
          } else {
            content.blocks.push(block);
          }
          break;
        case "update":
          content.blocks = content.blocks.map((b) =>
            b.id === blockId ? { ...b, ...block } : b
          );
          break;
        case "delete":
          content.blocks = content.blocks.filter((b) => b.id !== blockId);
          break;
        case "move": {
          const fromIdx = content.blocks.findIndex((b) => b.id === blockId);
          if (fromIdx >= 0 && typeof index === "number") {
            const [item] = content.blocks.splice(fromIdx, 1);
            content.blocks.splice(index, 0, item);
          }
          break;
        }
      }
    }

    // Save updated content
    await env.DOCS.put(r2Key, JSON.stringify(content), {
      httpMetadata: { contentType: "application/json" },
    });

    // Update D1 metadata
    let wordCount = 0;
    for (const block of content.blocks) {
      const text = block.content || "";
      wordCount += text.split(/\s+/).filter(Boolean).length;
    }

    await env.DB.prepare(
      `UPDATE documents SET version = version + 1, word_count = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(wordCount, id).run();

    return jsonResponse({ ok: true, id, blockCount: content.blocks.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleExportDocNotion(env, id, jsonResponse) {
  const r2Key = `docs/${id}.json`;

  try {
    const obj = await env.DOCS.get(r2Key);
    if (!obj) return jsonResponse({ _error: "Document not found" }, 404);

    const content = JSON.parse(await obj.text());
    const notionBlocks = (content.blocks || []).map(wasabiBlockToNotion);

    return jsonResponse({ blocks: notionBlocks });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// Convert Wasabi block format → Notion block API format
function wasabiBlockToNotion(block) {
  const richText = block.content
    ? [{ type: "text", text: { content: block.content } }]
    : [];

  switch (block.type) {
    case "heading_1":
      return { type: "heading_1", heading_1: { rich_text: richText } };
    case "heading_2":
      return { type: "heading_2", heading_2: { rich_text: richText } };
    case "heading_3":
      return { type: "heading_3", heading_3: { rich_text: richText } };
    case "bulleted_list_item":
      return { type: "bulleted_list_item", bulleted_list_item: { rich_text: richText } };
    case "numbered_list_item":
      return { type: "numbered_list_item", numbered_list_item: { rich_text: richText } };
    case "to_do":
      return { type: "to_do", to_do: { rich_text: richText, checked: block.checked || false } };
    case "toggle":
      return { type: "toggle", toggle: { rich_text: richText } };
    case "quote":
      return { type: "quote", quote: { rich_text: richText } };
    case "callout":
      return {
        type: "callout",
        callout: {
          rich_text: richText,
          icon: block.icon ? { type: "emoji", emoji: block.icon } : { type: "emoji", emoji: "💡" },
        },
      };
    case "code":
      return { type: "code", code: { rich_text: richText, language: block.language || "plain text" } };
    case "image":
      return {
        type: "image",
        image: { type: "external", external: { url: block.url || "" } },
      };
    case "bookmark":
      return { type: "bookmark", bookmark: { url: block.url || "" } };
    case "divider":
      return { type: "divider", divider: {} };
    default:
      return { type: "paragraph", paragraph: { rich_text: richText } };
  }
}
