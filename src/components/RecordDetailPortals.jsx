// ─── Record Detail Portals ───
// Renders RecordDetail and NewRecordModal based on useRecordDetail() hook state.
// Drop-in replacement for the duplicate rendering in Kanban, Calendar, CardGrid.

import React from "react";
import RecordDetail from "../views/RecordDetail.jsx";
import NewRecordModal from "../views/NewRecordModal.jsx";

/**
 * @param {object} props
 * @param {object} props.hook        - Return value of useRecordDetail()
 * @param {object} props.schema      - Database schema
 * @param {string} props.pageConfigId - Page config ID for RecordDetail
 * @param {string} props.databaseId  - Target database ID for NewRecordModal
 * @param {Function} [props.onUpdate] - (pageId, fieldName, payload) => void
 * @param {Function} [props.onCreate] - (data) => void
 * @param {Function} [props.onDelete] - (ids) => void
 */
export default function RecordDetailPortals({
  hook,
  schema,
  pageConfigId,
  databaseId,
  onUpdate,
  onCreate,
  onDelete,
  // Cell linking, supplied by ViewRenderer. Without these RecordDetail hides
  // the link affordance entirely, which is why records opened from Calendar,
  // CardGrid or Kanban could not be linked while the same record opened from
  // a table could.
  resolvedLinks,
  onLinkField,
  onUnlinkField,
  // Null when the user can't edit the schema — RecordDetail then hides the
  // "create option" affordance instead of offering a guaranteed 403.
  onCreateOption,
}) {
  const { detailPage, closeDetail, showNewModal, newModalPrefill, closeNew } = hook;

  return (
    <>
      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={detailPage._parentRowId && schema?._subSchema ? schema._subSchema : schema}
          onClose={closeDetail}
          onUpdate={onUpdate}
          onDelete={onDelete ? (ids) => { onDelete(ids); closeDetail(); } : undefined}
          pageConfigId={pageConfigId}
          resolvedLinks={resolvedLinks}
          onLinkField={onLinkField ? (fieldName, fieldType) => onLinkField(detailPage.id, fieldName, fieldType) : null}
          onUnlinkField={onUnlinkField}
          onCreateOption={onCreateOption ? (colName, optionName) => onCreateOption(detailPage, colName, optionName) : null}
        />
      )}

      {showNewModal && onCreate && (
        <NewRecordModal
          schema={schema}
          onClose={closeNew}
          onCreate={onCreate}
          databaseId={databaseId}
          prefill={newModalPrefill}
        />
      )}
    </>
  );
}
