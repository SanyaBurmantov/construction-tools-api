/**
 * Flat `<UiSelect>` options in tree order, so the indentation means nesting.
 * `/admin/categories` answers ordered by level, and indenting that list put
 * every child under the last root instead of under its own parent.
 */
export interface CategoryOptionSource {
  id: string
  name: string
  parentId: string | null
}

export function categoryTreeOptions(categories: CategoryOptionSource[]) {
  const byParent = new Map<string | null, CategoryOptionSource[]>()
  for (const category of categories) {
    const list = byParent.get(category.parentId) ?? []
    list.push(category)
    byParent.set(category.parentId, list)
  }
  const out: Array<{ value: string, label: string }> = []
  const walk = (parentId: string | null, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, 'ru'),
    )
    for (const child of children) {
      out.push({ value: child.id, label: `${'— '.repeat(depth)}${child.name}` })
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
