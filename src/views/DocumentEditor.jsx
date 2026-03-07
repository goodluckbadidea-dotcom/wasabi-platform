// ─── Document Editor ───
// Phase 1 block-level contentEditable editor.
// Each Notion block is a separate editable div.
// Supports: paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, code, divider.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { getBlocks, appendBlocks, updateBlock, deleteBlock } from "../notion/client.js";

// ─── Constants ───

const SAVE_DEBOUNCE_MS = 1500;

const BLOCK_TYPES = [
  { type: "paragraph", label: "Text", shortcut: "p" },
  { type: "heading_1", label: "Heading 1", shortcut: "1" },
  { type: "heading_2", label: "Heading 2", shortcut: "2" },
  { type: "heading_3", label: "Heading 3", shortcut: "3" },
  { type: "bulleted_list_item", label: "Bullet List", shortcut: "b" },
  { type: "numbered_list_item", label: "Numbered List", shortcut: "n" },
  { type: "code", label: "Code Block", shortcut: "c" },
  { type: "divider", label: "Divider", shortcut: "d" },
];

// ─── Rich Text ↔ HTML Conversion ───

/**
 * Convert Notion rich_text array to HTML string for contentEditable.
 */
function richTextToHtml(richTextArr) {
  if (!richTextArr?.length) return "";
  return richTextArr.map((rt) => {
    let html = escapeHtml(rt.plain_text || rt.text?.content || "");
    const ann = rt.annotations || {};
    if (ann.code) html = `<code>${html}</code>`;
    if (ann.bold) html = `<strong>${html}</strong>`;
    if (ann.italic) html = `<em>${html}</em>`;
    if (ann.strikethrough) html = `<s>${html}</s>`;
    if (ann.underline) html = `<u>${html}</u>`;
    if (rt.href || rt.text?.link?.url) {
      const url = rt.href || rt.text.link.url;
      html = `<a href="${escapeHtml(url)}">${html}</a>`;
    }
    return html;
  }).join("");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Parse contentEditable innerHTML back into Notion rich_text array.
 */
function htmlToRichText(html) {
  if (!html || html === "<br>" || html === "<br/>") return [];
  const div = document.createElement("div");
  div.innerHTML = html;
  const segments = [];
  walkNodes(div, {}, segments);
  // Merge adjacent segments with same annotations
  return mergeSegments(segments);
}

function walkNodes(node, parentAnnotations, segments) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (text) {
        segments.push({ text, annotations: { ...parentAnnotations }, href: null });
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      const ann = { ...parentAnnotations };
      let href = null;

      if (tag === "strong" || tag === "b") ann.bold = true;
      else if (tag === "em" || tag === "i") ann.italic = true;
      else if (tag === "s" || tag === "strike" || tag === "del") ann.strikethrough = true;
      else if (tag === "u") ann.underline = true;
      else if (tag === "code") ann.code = true;
      else if (tag === "a") href = child.getAttribute("href");
      else if (tag === "br") {
        segments.push({ text: "\n", annotations: { ...parentAnnotations }, href: null });
        continue;
      }

      if (href) {
        // For links, walk children with href context
        walkNodesWithHref(child, ann, href, segments);
      } else {
        walkNodes(child, ann, segments);
      }
    }
  }
}

function walkNodesWithHref(node, annotations, href, segments) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (text) {
        segments.push({ text, annotations: { ...annotations }, href });
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      const ann = { ...annotations };
      if (tag === "strong" || tag === "b") ann.bold = true;
      else if (tag === "em" || tag === "i") ann.italic = true;
      else if (tag === "code") ann.code = true;
      walkNodesWithHref(child, ann, href, segments);
    }
  }
}

function mergeSegments(segments) {
  if (!segments.length) return [];
  const result = [];
  for (const seg of segments) {
    const prev = result[result.length - 1];
    if (prev && sameAnnotations(prev.annotations, seg.annotations) && prev.href === seg.href) {
      prev.text += seg.text;
    } else {
      result.push({ ...seg });
    }
  }
  return result.map((seg) => {
    const rt = {
      type: "text",
      text: { content: seg.text },
      annotations: {
        bold: seg.annotations.bold || false,
        italic: seg.annotations.italic || false,
        strikethrough: seg.annotations.strikethrough || false,
        underline: seg.annotations.underline || false,
        code: seg.annotations.code || false,
        color: "default",
      },
    };
    if (seg.href) {
      rt.text.link = { url: seg.href };
      rt.href = seg.href;
    }
    return rt;
  });
}

function sameAnnotations(a, b) {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strikethrough === !!b.strikethrough &&
    !!a.underline === !!b.underline &&
    !!a.code === !!b.code
  );
}

// ─── Block Helpers ───

let _tempIdCounter = 0;
function tempId() {
  return `_temp_${Date.now()}_${++_tempIdCounter}`;
}

function createEmptyBlock(type = "paragraph") {
  if (type === "divider") {
    return { id: tempId(), type: "divider", divider: {}, _isNew: true, _dirty: true };
  }
  return {
    id: tempId(),
    type,
    [type]: { rich_text: [] },
    _isNew: true,
    _dirty: true,
  };
}

function getBlockText(block) {
  const content = block[block.type];
  return content?.rich_text?.map((rt) => rt.plain_text || rt.text?.content || "").join("") || "";
}

// ─── Styles ───

const toolbarStyle = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  padding: "6px 12px",
  borderBottom: `1px solid ${C.darkBorder}`,
  background: C.darkSurf,
  flexShrink: 0,
  flexWrap: "wrap",
};

const toolBtnBase = {
  background: "none",
  border: `1px solid transparent`,
  borderRadius: RADIUS.sm,
  padding: "4px 8px",
  cursor: "pointer",
  color: C.darkMuted,
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  transition: "all 0.1s",
  outline: "none",
};

function toolBtn(active) {
  return {
    ...toolBtnBase,
    background: active ? C.darkSurf2 : "none",
    color: active ? C.darkText : C.darkMuted,
    borderColor: active ? C.darkBorder : "transparent",
  };
}

const blockWrapBase = {
  position: "relative",
  padding: "2px 0",
  minHeight: 24,
};

function blockStyle(type) {
  const base = {
    outline: "none",
    fontFamily: FONT,
    color: C.darkText,
    lineHeight: 1.7,
    caretColor: C.accent,
    wordBreak: "break-word",
  };
  switch (type) {
    case "heading_1":
      return { ...base, fontSize: 22, fontWeight: 700, margin: "20px 0 4px" };
    case "heading_2":
      return { ...base, fontSize: 18, fontWeight: 600, margin: "16px 0 2px" };
    case "heading_3":
      return { ...base, fontSize: 15, fontWeight: 600, margin: "12px 0 2px" };
    case "bulleted_list_item":
    case "numbered_list_item":
      return { ...base, fontSize: 14, paddingLeft: 24 };
    case "code":
      return {
        ...base,
        fontFamily: MONO,
        fontSize: 12,
        background: C.dark,
        borderRadius: RADIUS.lg,
        padding: "12px 16px",
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        overflowX: "auto",
        margin: "6px 0",
      };
    default:
      return { ...base, fontSize: 14 };
  }
}

const listBulletStyle = {
  position: "absolute",
  left: 4,
  top: 5,
  fontSize: 14,
  color: C.darkMuted,
  pointerEvents: "none",
  userSelect: "none",
  lineHeight: 1.7,
};

// ─── Slash Command Menu ───

function SlashMenu({ position, filter, onSelect, onClose }) {
  const filtered = BLOCK_TYPES.filter((bt) =>
    bt.label.toLowerCase().includes(filter.toLowerCase()) ||
    bt.shortcut === filter.toLowerCase()
  );

  if (!filtered.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        zIndex: 1000,
        padding: "4px 0",
        minWidth: 180,
        maxHeight: 260,
        overflowY: "auto",
      }}
    >
      {filtered.map((bt) => (
        <button
          key={bt.type}
          onClick={() => onSelect(bt.type)}
          style={{
            display: "block",
            width: "100%",
            background: "none",
            border: "none",
            padding: "8px 14px",
            textAlign: "left",
            cursor: "pointer",
            color: C.darkText,
            fontFamily: FONT,
            fontSize: 13,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          {bt.label}
          <span style={{ float: "right", color: C.darkMuted, fontSize: 11 }}>/{bt.shortcut}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Link Popup ───

function LinkPopup({ position, initialUrl, onSubmit, onClose }) {
  const [url, setUrl] = useState(initialUrl || "");
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (url.trim()) onSubmit(url.trim());
    else onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        zIndex: 1000,
        padding: 12,
        display: "flex",
        gap: 8,
      }}
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          style={{
            background: C.dark,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.sm,
            padding: "6px 10px",
            fontSize: 13,
            fontFamily: FONT,
            color: C.darkText,
            width: 240,
            outline: "none",
          }}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        />
        <button
          type="submit"
          style={{
            background: C.accent,
            border: "none",
            borderRadius: RADIUS.sm,
            padding: "6px 12px",
            color: "#fff",
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Link
        </button>
      </form>
    </div>
  );
}

// ─── Editable Block ───

const EditableBlock = React.memo(function EditableBlock({
  block,
  index,
  focused,
  onFocus,
  onChange,
  onKeyDown,
  onSplit,
  onMerge,
  onDelete,
  blockRef,
}) {
  const ref = useRef(null);
  const isComposing = useRef(false);

  // Set ref for parent
  useEffect(() => {
    if (blockRef) blockRef.current = ref.current;
  }, [blockRef]);

  // Focus management
  useEffect(() => {
    if (focused && ref.current && document.activeElement !== ref.current) {
      ref.current.focus();
    }
  }, [focused]);

  // Sync HTML content with block state (only when block changes externally)
  const html = useMemo(() => {
    const content = block[block.type];
    return richTextToHtml(content?.rich_text || []);
  }, [block.id, block._lastSync]);

  useEffect(() => {
    if (ref.current && !focused) {
      const content = block[block.type];
      ref.current.innerHTML = richTextToHtml(content?.rich_text || []);
    }
  }, [html]);

  // Divider blocks are non-editable
  if (block.type === "divider") {
    return (
      <div style={{ ...blockWrapBase, padding: "8px 0" }}>
        <hr
          style={{
            border: "none",
            height: 1,
            background: C.darkBorder,
            margin: 0,
            cursor: "pointer",
          }}
          onClick={() => onFocus(index)}
        />
      </div>
    );
  }

  const handleInput = () => {
    if (isComposing.current) return;
    const newHtml = ref.current?.innerHTML || "";
    const richText = htmlToRichText(newHtml);
    onChange(index, richText);
  };

  const handleKeyDown = (e) => {
    if (isComposing.current) return;

    // Enter: split block
    if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;

      // Get cursor position in terms of text content
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(ref.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const preHtml = rangeToHtml(preRange, ref.current);
      const postRange = document.createRange();
      postRange.selectNodeContents(ref.current);
      postRange.setStart(range.endContainer, range.endOffset);
      const postHtml = rangeToHtml(postRange, ref.current);

      const preParts = htmlToRichText(preHtml);
      const postParts = htmlToRichText(postHtml);

      onSplit(index, preParts, postParts);
      return;
    }

    // Shift+Enter in code: just newline (default behavior)
    // Enter in code: also default (newline)

    // Backspace at start: merge with previous block
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        if (range.collapsed && isAtStart(ref.current, range)) {
          e.preventDefault();
          onMerge(index);
          return;
        }
      }
    }

    // Delete at end: merge next into current
    if (e.key === "Delete") {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        if (range.collapsed && isAtEnd(ref.current, range)) {
          e.preventDefault();
          onDelete(index);
          return;
        }
      }
    }

    // Slash command handling is done in parent
    if (onKeyDown) onKeyDown(e, index);
  };

  const showBullet = block.type === "bulleted_list_item";
  const showNumber = block.type === "numbered_list_item";

  return (
    <div style={blockWrapBase}>
      {showBullet && <span style={listBulletStyle}>•</span>}
      {showNumber && (
        <span style={listBulletStyle}>{(block._listIndex || 1)}.</span>
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus(index)}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        style={blockStyle(block.type)}
        data-block-index={index}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

// ─── Range Helpers ───

function rangeToHtml(range, container) {
  const fragment = range.cloneContents();
  const div = document.createElement("div");
  div.appendChild(fragment);
  return div.innerHTML;
}

function isAtStart(el, range) {
  if (!range.collapsed) return false;
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length === 0;
}

function isAtEnd(el, range) {
  if (!range.collapsed) return false;
  const postRange = document.createRange();
  postRange.selectNodeContents(el);
  postRange.setStart(range.endContainer, range.endOffset);
  return postRange.toString().length === 0;
}

// ─── Main Editor Component ───

export default function DocumentEditor({ pageId }) {
  const { user } = usePlatform();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved"); // saved | saving | error
  const [focusIdx, setFocusIdx] = useState(null);
  const [slashMenu, setSlashMenu] = useState(null); // { index, position, filter }
  const [linkPopup, setLinkPopup] = useState(null); // { position }
  const saveTimerRef = useRef(null);
  const blockRefs = useRef({});
  const deletedIdsRef = useRef([]);

  // ── Load blocks ──
  const loadBlocks = useCallback(async () => {
    if (!user?.workerUrl || !user?.notionKey || !pageId) {
      setLoading(false);
      return;
    }
    try {
      const result = await getBlocks(user.workerUrl, user.notionKey, pageId);
      const loaded = (result || []).map((b) => ({
        ...b,
        _dirty: false,
        _isNew: false,
        _lastSync: Date.now(),
      }));
      // Add an empty paragraph if page is empty
      if (!loaded.length) {
        loaded.push(createEmptyBlock("paragraph"));
      }
      setBlocks(loaded);
      setError(null);
    } catch (err) {
      console.error("Failed to load document:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, pageId]);

  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  // ── Number list items ──
  const numberedBlocks = useMemo(() => {
    let counter = 0;
    return blocks.map((b) => {
      if (b.type === "numbered_list_item") {
        counter++;
        return { ...b, _listIndex: counter };
      }
      counter = 0;
      return b;
    });
  }, [blocks]);

  // ── Autosave ──
  const performSave = useCallback(async () => {
    if (!user?.workerUrl || !user?.notionKey || !pageId) return;

    const dirtyBlocks = blocks.filter((b) => b._dirty);
    const toDelete = [...deletedIdsRef.current];
    if (!dirtyBlocks.length && !toDelete.length) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("saving");
    try {
      // Delete removed blocks
      for (const id of toDelete) {
        if (!id.startsWith("_temp_")) {
          await deleteBlock(user.workerUrl, user.notionKey, id);
        }
      }
      deletedIdsRef.current = [];

      // Process dirty blocks
      for (const block of dirtyBlocks) {
        const blockData = buildBlockPayload(block);
        if (block._isNew) {
          // Append as child of the page
          const result = await appendBlocks(user.workerUrl, user.notionKey, pageId, [blockData]);
          const newId = result?.results?.[0]?.id;
          if (newId) {
            setBlocks((prev) =>
              prev.map((b) =>
                b.id === block.id ? { ...b, id: newId, _isNew: false, _dirty: false, _lastSync: Date.now() } : b
              )
            );
          }
        } else {
          await updateBlock(user.workerUrl, user.notionKey, block.id, blockData);
          setBlocks((prev) =>
            prev.map((b) =>
              b.id === block.id ? { ...b, _dirty: false, _lastSync: Date.now() } : b
            )
          );
        }
      }
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("error");
    }
  }, [blocks, user, pageId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("unsaved");
    saveTimerRef.current = setTimeout(performSave, SAVE_DEBOUNCE_MS);
  }, [performSave]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Block Operations ──

  const handleBlockChange = useCallback((index, richText) => {
    setBlocks((prev) => {
      const updated = [...prev];
      const block = { ...updated[index] };
      block[block.type] = { ...block[block.type], rich_text: richText };
      block._dirty = true;
      updated[index] = block;
      return updated;
    });
    scheduleSave();
  }, [scheduleSave]);

  const handleSplit = useCallback((index, preParts, postParts) => {
    setBlocks((prev) => {
      const updated = [...prev];
      const current = { ...updated[index] };

      // Update current block with pre-cursor content
      current[current.type] = { ...current[current.type], rich_text: preParts };
      current._dirty = true;
      updated[index] = current;

      // Create new block with post-cursor content
      const newBlock = createEmptyBlock("paragraph");
      newBlock.paragraph.rich_text = postParts;
      updated.splice(index + 1, 0, newBlock);

      return updated;
    });
    setFocusIdx(index + 1);
    scheduleSave();
  }, [scheduleSave]);

  const handleMerge = useCallback((index) => {
    if (index === 0) {
      // If not paragraph, convert to paragraph
      setBlocks((prev) => {
        if (prev[0].type === "paragraph") return prev;
        const updated = [...prev];
        const block = { ...updated[0] };
        const richText = block[block.type]?.rich_text || [];
        delete block[block.type];
        block.type = "paragraph";
        block.paragraph = { rich_text: richText };
        block._dirty = true;
        updated[0] = block;
        return updated;
      });
      scheduleSave();
      return;
    }

    setBlocks((prev) => {
      const updated = [...prev];
      const prevBlock = { ...updated[index - 1] };
      const currBlock = updated[index];

      // Can't merge into a divider
      if (prevBlock.type === "divider") return prev;

      // Merge rich text
      const prevRT = prevBlock[prevBlock.type]?.rich_text || [];
      const currRT = currBlock[currBlock.type]?.rich_text || [];
      prevBlock[prevBlock.type] = { ...prevBlock[prevBlock.type], rich_text: [...prevRT, ...currRT] };
      prevBlock._dirty = true;
      updated[index - 1] = prevBlock;

      // Track deletion
      if (!currBlock.id.startsWith("_temp_")) {
        deletedIdsRef.current.push(currBlock.id);
      }
      updated.splice(index, 1);

      return updated;
    });
    setFocusIdx(index - 1);
    scheduleSave();
  }, [scheduleSave]);

  const handleDeleteAtEnd = useCallback((index) => {
    setBlocks((prev) => {
      if (index >= prev.length - 1) return prev;
      const updated = [...prev];
      const currBlock = { ...updated[index] };
      const nextBlock = updated[index + 1];

      if (nextBlock.type === "divider") {
        if (!nextBlock.id.startsWith("_temp_")) {
          deletedIdsRef.current.push(nextBlock.id);
        }
        updated.splice(index + 1, 1);
        return updated;
      }

      // Merge next into current
      const currRT = currBlock[currBlock.type]?.rich_text || [];
      const nextRT = nextBlock[nextBlock.type]?.rich_text || [];
      currBlock[currBlock.type] = { ...currBlock[currBlock.type], rich_text: [...currRT, ...nextRT] };
      currBlock._dirty = true;
      updated[index] = currBlock;

      if (!nextBlock.id.startsWith("_temp_")) {
        deletedIdsRef.current.push(nextBlock.id);
      }
      updated.splice(index + 1, 1);
      return updated;
    });
    scheduleSave();
  }, [scheduleSave]);

  // ── Block Type Change ──

  const changeBlockType = useCallback((index, newType) => {
    setBlocks((prev) => {
      const updated = [...prev];
      const block = { ...updated[index] };
      const richText = block[block.type]?.rich_text || [];

      if (newType === "divider") {
        // Replace with divider, lose text
        const divider = createEmptyBlock("divider");
        divider.id = block.id;
        divider._isNew = block._isNew;
        divider._dirty = true;
        updated[index] = divider;
      } else {
        delete block[block.type];
        block.type = newType;
        block[newType] = { rich_text: richText };
        block._dirty = true;
        updated[index] = block;
      }
      return updated;
    });
    setSlashMenu(null);
    scheduleSave();
  }, [scheduleSave]);

  // ── Toolbar Formatting ──

  const execFormat = useCallback((command, value) => {
    document.execCommand(command, false, value || null);
    // Trigger change detection on the focused block
    if (focusIdx != null) {
      const el = blockRefs.current[focusIdx];
      if (el) {
        const richText = htmlToRichText(el.innerHTML);
        handleBlockChange(focusIdx, richText);
      }
    }
  }, [focusIdx, handleBlockChange]);

  const handleInsertLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setLinkPopup({
      position: { top: rect.bottom + 4, left: rect.left },
    });
  }, []);

  const handleLinkSubmit = useCallback((url) => {
    document.execCommand("createLink", false, url);
    setLinkPopup(null);
    if (focusIdx != null) {
      const el = blockRefs.current[focusIdx];
      if (el) {
        const richText = htmlToRichText(el.innerHTML);
        handleBlockChange(focusIdx, richText);
      }
    }
  }, [focusIdx, handleBlockChange]);

  const handleInsertDivider = useCallback(() => {
    if (focusIdx == null) return;
    setBlocks((prev) => {
      const updated = [...prev];
      const divider = createEmptyBlock("divider");
      const newPara = createEmptyBlock("paragraph");
      updated.splice(focusIdx + 1, 0, divider, newPara);
      return updated;
    });
    setFocusIdx(focusIdx + 2);
    scheduleSave();
  }, [focusIdx, scheduleSave]);

  // ── Keyboard shortcuts ──

  const handleBlockKeyDown = useCallback((e, index) => {
    // Cmd+B, Cmd+I, Cmd+K
    if ((e.metaKey || e.ctrlKey) && e.key === "b") {
      e.preventDefault();
      execFormat("bold");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "i") {
      e.preventDefault();
      execFormat("italic");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      handleInsertLink();
      return;
    }
    // Cmd+Shift+S: strikethrough
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "s") {
      e.preventDefault();
      execFormat("strikeThrough");
      return;
    }
    // Cmd+E: inline code
    if ((e.metaKey || e.ctrlKey) && e.key === "e") {
      e.preventDefault();
      // Toggle code on selection using insertHTML
      const sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed) {
        const selectedText = sel.toString();
        const range = sel.getRangeAt(0);
        // Check if already code
        const parent = range.commonAncestorContainer.parentElement;
        if (parent?.tagName?.toLowerCase() === "code") {
          // Unwrap code
          document.execCommand("insertHTML", false, selectedText);
        } else {
          document.execCommand("insertHTML", false, `<code>${escapeHtml(selectedText)}</code>`);
        }
        if (focusIdx != null) {
          const el = blockRefs.current[focusIdx];
          if (el) handleBlockChange(focusIdx, htmlToRichText(el.innerHTML));
        }
      }
      return;
    }

    // Slash command
    if (e.key === "/" && blocks[index]) {
      const el = blockRefs.current[index];
      const text = el?.textContent || "";
      if (text === "" || text === "/") {
        // Show slash menu
        const rect = el?.getBoundingClientRect();
        if (rect) {
          setSlashMenu({
            index,
            position: { top: rect.bottom + 4, left: rect.left },
            filter: "",
          });
        }
      }
    }

    // Arrow up/down for block navigation
    if (e.key === "ArrowUp" && index > 0) {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const el = blockRefs.current[index];
        if (el && isAtStart(el, range)) {
          e.preventDefault();
          setFocusIdx(index - 1);
        }
      }
    }
    if (e.key === "ArrowDown" && index < blocks.length - 1) {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const el = blockRefs.current[index];
        if (el && isAtEnd(el, range)) {
          e.preventDefault();
          setFocusIdx(index + 1);
        }
      }
    }

    // Escape: close slash menu
    if (e.key === "Escape") {
      if (slashMenu) setSlashMenu(null);
      if (linkPopup) setLinkPopup(null);
    }
  }, [blocks, execFormat, focusIdx, handleBlockChange, handleInsertLink, slashMenu, linkPopup]);

  // ── Slash menu selection ──
  const handleSlashSelect = useCallback((type) => {
    if (slashMenu == null) return;
    const idx = slashMenu.index;
    // Clear the slash character
    const el = blockRefs.current[idx];
    if (el) {
      el.innerHTML = "";
      handleBlockChange(idx, []);
    }
    changeBlockType(idx, type);
    setSlashMenu(null);
    setTimeout(() => setFocusIdx(idx), 50);
  }, [slashMenu, changeBlockType, handleBlockChange]);

  // ── Click outside to close menus ──
  useEffect(() => {
    const handler = (e) => {
      if (slashMenu) setSlashMenu(null);
      if (linkPopup) setLinkPopup(null);
    };
    if (slashMenu || linkPopup) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [slashMenu, linkPopup]);

  // ── Render ──

  if (!pageId) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No page ID configured for this document.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading document...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Failed to load: {error}
        <button
          onClick={loadBlocks}
          style={{
            display: "block",
            margin: "12px auto",
            background: C.accent,
            color: "#fff",
            border: "none",
            borderRadius: RADIUS.sm,
            padding: "6px 16px",
            fontFamily: FONT,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const currentBlockType = focusIdx != null && blocks[focusIdx] ? blocks[focusIdx].type : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT }}>
      {/* Toolbar */}
      <div style={toolbarStyle}>
        {/* Save indicator */}
        <span style={{
          fontSize: 11,
          color: saveStatus === "saving" ? C.accent : saveStatus === "error" ? "#E05252" : C.darkMuted,
          marginRight: 8,
          minWidth: 50,
        }}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "error" ? "Error" : saveStatus === "unsaved" ? "Unsaved" : "Saved"}
        </span>

        <div style={{ width: 1, height: 18, background: C.darkBorder, margin: "0 6px" }} />

        {/* Inline formatting */}
        <button style={toolBtn(false)} onClick={() => execFormat("bold")} title="Bold (Cmd+B)">
          <strong>B</strong>
        </button>
        <button style={toolBtn(false)} onClick={() => execFormat("italic")} title="Italic (Cmd+I)">
          <em>I</em>
        </button>
        <button style={toolBtn(false)} onClick={() => execFormat("strikeThrough")} title="Strikethrough">
          <s>S</s>
        </button>
        <button style={{ ...toolBtn(false), fontFamily: MONO, fontSize: 11 }} onClick={() => execFormat("insertHTML", `<code>${window.getSelection()?.toString() || ""}</code>`)} title="Code (Cmd+E)">
          {"</>"}
        </button>
        <button style={toolBtn(false)} onClick={handleInsertLink} title="Link (Cmd+K)">
          🔗
        </button>

        <div style={{ width: 1, height: 18, background: C.darkBorder, margin: "0 6px" }} />

        {/* Block type buttons */}
        <button style={toolBtn(currentBlockType === "heading_1")} onClick={() => focusIdx != null && changeBlockType(focusIdx, "heading_1")} title="Heading 1">
          H1
        </button>
        <button style={toolBtn(currentBlockType === "heading_2")} onClick={() => focusIdx != null && changeBlockType(focusIdx, "heading_2")} title="Heading 2">
          H2
        </button>
        <button style={toolBtn(currentBlockType === "heading_3")} onClick={() => focusIdx != null && changeBlockType(focusIdx, "heading_3")} title="Heading 3">
          H3
        </button>
        <button style={toolBtn(currentBlockType === "bulleted_list_item")} onClick={() => focusIdx != null && changeBlockType(focusIdx, "bulleted_list_item")} title="Bullet List">
          •
        </button>
        <button style={toolBtn(currentBlockType === "numbered_list_item")} onClick={() => focusIdx != null && changeBlockType(focusIdx, "numbered_list_item")} title="Numbered List">
          1.
        </button>
        <button style={toolBtn(currentBlockType === "code")} onClick={() => focusIdx != null && changeBlockType(focusIdx, "code")} title="Code Block">
          {"{ }"}
        </button>
        <button style={toolBtn(false)} onClick={handleInsertDivider} title="Divider">
          ―
        </button>
        <button
          style={toolBtn(currentBlockType === "paragraph")}
          onClick={() => focusIdx != null && changeBlockType(focusIdx, "paragraph")}
          title="Paragraph"
        >
          ¶
        </button>
      </div>

      {/* Editor body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 32px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 700, minHeight: "100%" }}>
          {numberedBlocks.map((block, i) => (
            <EditableBlock
              key={block.id}
              block={block}
              index={i}
              focused={focusIdx === i}
              onFocus={setFocusIdx}
              onChange={handleBlockChange}
              onKeyDown={handleBlockKeyDown}
              onSplit={handleSplit}
              onMerge={handleMerge}
              onDelete={handleDeleteAtEnd}
              blockRef={{ current: null, set: (el) => { blockRefs.current[i] = el; } }}
            />
          ))}

          {/* Click below last block to add new */}
          <div
            style={{ minHeight: 200, cursor: "text" }}
            onClick={() => {
              // If last block has content, add new empty block
              const last = blocks[blocks.length - 1];
              if (last && getBlockText(last)) {
                setBlocks((prev) => [...prev, createEmptyBlock("paragraph")]);
                setFocusIdx(blocks.length);
                scheduleSave();
              } else {
                // Focus last block
                setFocusIdx(blocks.length - 1);
              }
            }}
          />
        </div>
      </div>

      {/* Slash menu */}
      {slashMenu && (
        <SlashMenu
          position={slashMenu.position}
          filter={slashMenu.filter}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />
      )}

      {/* Link popup */}
      {linkPopup && (
        <LinkPopup
          position={linkPopup.position}
          onSubmit={handleLinkSubmit}
          onClose={() => setLinkPopup(null)}
        />
      )}
    </div>
  );
}

// ─── Build Notion Block Payload ───

function buildBlockPayload(block) {
  if (block.type === "divider") {
    return { type: "divider", divider: {} };
  }
  const content = block[block.type] || {};
  return {
    type: block.type,
    [block.type]: {
      rich_text: (content.rich_text || []).map((rt) => ({
        type: "text",
        text: {
          content: rt.text?.content || rt.plain_text || "",
          link: rt.text?.link || (rt.href ? { url: rt.href } : null),
        },
        annotations: rt.annotations || {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      })),
      ...(block.type === "code" && content.language ? { language: content.language } : {}),
    },
  };
}
