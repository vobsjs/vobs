import { dictPlugin } from '@vobs/dict'

const statuses = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived', disabled: true }
] as const

export const mockApiPluginInstance = dictPlugin({
  data: { statuses },
  loader: async name => {
    await new Promise<void>(resolve => setTimeout(resolve, 220))
    return name === 'statuses' ? statuses : []
  }
})
