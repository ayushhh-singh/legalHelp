import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { editorExtensions } from './extensions'

import { BODY_NODES, bodySchema } from '@/lib/drafting/model'

describe('the editor produces only nodes the model can store', () => {
  it('every schema node name is one the model knows', () => {
    const editor = new Editor({ extensions: editorExtensions({ placeholder: 'x' }) })
    const names = Object.keys(editor.schema.nodes)
    editor.destroy()
    const unknown = names.filter((name) => !(BODY_NODES as readonly string[]).includes(name))
    expect(unknown).toEqual([])
  })

  it('round-trips a document with each of the app-specific nodes', () => {
    const editor = new Editor({
      extensions: editorExtensions({ placeholder: 'x' }),
      content: {
        type: 'doc',
        content: [
          { type: 'numberedPara', attrs: { level: 1 }, content: [{ type: 'text', text: 'One.' }] },
          {
            type: 'numberedPara',
            attrs: { level: 2 },
            content: [{ type: 'placeholder', attrs: { field: 'fileNumber' } }],
          },
          { type: 'pageBreak' },
        ],
      },
    })
    const json = editor.getJSON()
    editor.destroy()
    expect(bodySchema.safeParse(json).success).toBe(true)
  })
})
