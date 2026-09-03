import { Link } from 'react-router-dom'

import { parseNote, type InlineNode } from '@/lib/library'

/**
 * A margin note, rendered from its AST.
 *
 * NOTHING HERE TOUCHES `dangerouslySetInnerHTML`. `parseNote` returns nodes and
 * this walks them, so React escapes every leaf — which matters because a note
 * is the only place in this app where text a person typed is rendered with
 * structure. The URL of a link is the one thing React does not escape for us,
 * and `safeHref` has already refused anything that is not http(s) or a route
 * inside this app before the node is built.
 *
 * An unresolved `[[work:unit]]` renders as plain text with a title saying so,
 * never as a link to a page that does not exist.
 */

export interface WikiTarget {
  href: string
  label: string
}

interface NoteBodyProps {
  body: string
  /** Resolves `[[work:unit]]`. `null` for a unit this device does not have. */
  resolveWiki: (workId: string, unitId: string) => WikiTarget | null
  unresolvedLabel: string
  className?: string
}

function Inline({
  nodes,
  resolveWiki,
  unresolvedLabel,
}: {
  nodes: readonly InlineNode[]
  resolveWiki: NoteBodyProps['resolveWiki']
  unresolvedLabel: string
}) {
  return (
    <>
      {nodes.map((node, index) => {
        const key = index
        if (node.type === 'text') return <span key={key}>{node.value}</span>
        if (node.type === 'strong')
          return (
            <strong key={key}>
              <Inline nodes={node.children} resolveWiki={resolveWiki} unresolvedLabel={unresolvedLabel} />
            </strong>
          )
        if (node.type === 'emphasis')
          return (
            <em key={key}>
              <Inline nodes={node.children} resolveWiki={resolveWiki} unresolvedLabel={unresolvedLabel} />
            </em>
          )
        if (node.type === 'link') {
          const internal = node.href.startsWith('/')
          const content = (
            <Inline nodes={node.children} resolveWiki={resolveWiki} unresolvedLabel={unresolvedLabel} />
          )
          return internal ? (
            <Link key={key} to={node.href} className="text-primary underline underline-offset-4">
              {content}
            </Link>
          ) : (
            <a
              key={key}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              {content}
            </a>
          )
        }

        const target = resolveWiki(node.workId, node.unitId)
        if (!target) {
          return (
            <span key={key} title={unresolvedLabel} className="text-muted-foreground italic">
              {node.raw}
            </span>
          )
        }
        return (
          <Link
            key={key}
            to={target.href}
            title={target.label}
            className="text-primary underline decoration-dotted underline-offset-4"
          >
            {node.raw}
          </Link>
        )
      })}
    </>
  )
}

export function NoteBody({ body, resolveWiki, unresolvedLabel, className }: NoteBodyProps) {
  const blocks = parseNote(body)

  return (
    <div className={className}>
      {blocks.map((block, index) =>
        block.type === 'paragraph' ? (
          <p key={index} className="mb-2 text-sm last:mb-0">
            <Inline nodes={block.children} resolveWiki={resolveWiki} unresolvedLabel={unresolvedLabel} />
          </p>
        ) : block.ordered ? (
          <ol key={index} className="mb-2 ml-5 list-decimal text-sm last:mb-0">
            {block.items.map((item, at) => (
              <li key={at}>
                <Inline nodes={item} resolveWiki={resolveWiki} unresolvedLabel={unresolvedLabel} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} className="mb-2 ml-5 list-disc text-sm last:mb-0">
            {block.items.map((item, at) => (
              <li key={at}>
                <Inline nodes={item} resolveWiki={resolveWiki} unresolvedLabel={unresolvedLabel} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
