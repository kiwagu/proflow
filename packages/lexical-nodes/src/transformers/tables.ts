/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/*
 * Copied from facebook/lexical v0.45.0
 * (packages/lexical-playground/src/plugins/MarkdownTransformers/index.ts),
 * MIT — the `TABLE` transformer and its helpers.
 *
 * Two divergences. The transformer is a factory: cell content is read and
 * written with the list the table itself belongs to, supplied lazily because
 * that list contains the table (see `createTableTransformer`). And a cell's
 * text is trimmed before it is parsed, as GFM specifies — the spaces around
 * `| cell |` are layout, and a block rule anchored at column 0 would
 * otherwise never see a cell that is one block.
 */
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  type Transformer,
} from '@lexical/markdown';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableCellNode,
  TableCellNode as TableCellNodeClass,
  TableNode,
  TableRowNode,
} from '@lexical/table';
import { $isParagraphNode, $isTextNode, type LexicalNode } from 'lexical';

const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-*:? ?)+\|\s?$/;

/** The list a table's cells are read and written with, resolved when needed. */
type CellTransformers = () => Array<Transformer>;

function getTableColumnsSize(table: TableNode) {
  const row = table.getFirstChild();
  return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

const $createTableCell = (
  textContent: string,
  cellTransformers: CellTransformers
): TableCellNode => {
  const content = textContent.replace(/\\n/g, '\n').trim();
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  $convertFromMarkdownString(content, cellTransformers(), cell);
  return cell;
};

const mapToTableCells = (
  textContent: string,
  cellTransformers: CellTransformers
): Array<TableCellNode> | null => {
  const match = textContent.match(TABLE_ROW_REG_EXP);
  if (!match || !match[1]) {
    return null;
  }
  return match[1]
    .split('|')
    .map((text) => $createTableCell(text, cellTransformers));
};

/**
 * The table transformer for ONE transformer list.
 *
 * A cell holds blocks of its own, so its contents are converted with a
 * transformer list — and the only list that gives the caller what they asked
 * for is the one this table is part of. A table in the portable list writes
 * its cells in the portable form; a table in the lossless list keeps every
 * internal tag; a table inside a cell is exported by the same list again, so
 * nesting cannot change the form either. That list contains the transformer
 * being built here, which is why it arrives as a thunk rather than a value.
 */
export function createTableTransformer(
  cellTransformers: CellTransformers
): ElementTransformer {
  return {
    dependencies: [TableNode, TableRowNode, TableCellNodeClass],
    export: (node: LexicalNode) => {
      if (!$isTableNode(node)) {
        return null;
      }

      const output: string[] = [];

      for (const row of node.getChildren()) {
        const rowOutput = [];
        if (!$isTableRowNode(row)) {
          continue;
        }

        let isHeaderRow = false;
        for (const cell of row.getChildren()) {
          if ($isTableCellNode(cell)) {
            rowOutput.push(
              $convertToMarkdownString(cellTransformers(), cell)
                .replace(/\n/g, '\\n')
                .trim()
            );
            if (cell.__headerState === TableCellHeaderStates.ROW) {
              isHeaderRow = true;
            }
          }
        }

        output.push(`| ${rowOutput.join(' | ')} |`);
        if (isHeaderRow) {
          output.push(`| ${rowOutput.map(() => '---').join(' | ')} |`);
        }
      }

      return output.join('\n');
    },
    regExp: TABLE_ROW_REG_EXP,
    replace: (parentNode, _1, match) => {
      // Header row
      if (TABLE_ROW_DIVIDER_REG_EXP.test(match[0] ?? '')) {
        const table = parentNode.getPreviousSibling();
        if (!table || !$isTableNode(table)) {
          return;
        }

        const rows = table.getChildren();
        const lastRow = rows[rows.length - 1];
        if (!lastRow || !$isTableRowNode(lastRow)) {
          return;
        }

        lastRow.getChildren().forEach((cell) => {
          if (!$isTableCellNode(cell)) {
            return;
          }
          cell.setHeaderStyles(
            TableCellHeaderStates.ROW,
            TableCellHeaderStates.ROW
          );
        });

        parentNode.remove();
        return;
      }

      const matchCells = mapToTableCells(match[0] ?? '', cellTransformers);

      if (matchCells == null) {
        return;
      }

      const rows = [matchCells];
      let sibling = parentNode.getPreviousSibling();
      let maxCells = matchCells.length;

      while (sibling) {
        if (!$isParagraphNode(sibling)) {
          break;
        }

        if (sibling.getChildrenSize() !== 1) {
          break;
        }

        const firstChild = sibling.getFirstChild();

        if (!$isTextNode(firstChild)) {
          break;
        }

        const cells = mapToTableCells(
          firstChild.getTextContent(),
          cellTransformers
        );

        if (cells == null) {
          break;
        }

        maxCells = Math.max(maxCells, cells.length);
        rows.unshift(cells);
        const previousSibling = sibling.getPreviousSibling();
        sibling.remove();
        sibling = previousSibling;
      }

      const table = $createTableNode();

      for (const cells of rows) {
        const tableRow = $createTableRowNode();
        table.append(tableRow);

        for (let i = 0; i < maxCells; i++) {
          tableRow.append(
            i < cells.length
              ? cells[i]!
              : $createTableCell('', cellTransformers)
          );
        }
      }

      const previousSibling = parentNode.getPreviousSibling();
      if (
        $isTableNode(previousSibling) &&
        getTableColumnsSize(previousSibling) === maxCells
      ) {
        previousSibling.append(...table.getChildren());
        parentNode.remove();
      } else {
        parentNode.replace(table);
      }

      table.selectEnd();
    },
    type: 'element',
  };
}
