import { ValidationError, type CollectionBeforeChangeHook } from 'payload'
import { resolveCategoryGroups } from '../categoryGroupRules'

export const validateCategoryGroups: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  collection,
}) => {
  const { errors, clean } = resolveCategoryGroups(data, originalDoc)

  if (errors.length > 0) {
    throw new ValidationError({ collection: collection.slug, errors })
  }

  return { ...data, ...clean }
}