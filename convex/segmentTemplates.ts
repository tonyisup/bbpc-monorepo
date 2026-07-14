import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdminSecret } from './access';

const segmentType = v.union(
  v.literal('intro'),
  v.literal('segment'),
  v.literal('ad'),
  v.literal('outro'),
  v.literal('news'),
  v.literal('interview'),
);

const segmentTemplateInput = v.object({
  id: v.string(),
  label: v.string(),
  type: segmentType,
  introSounder: v.optional(v.string()),
  outroSounder: v.optional(v.string()),
  sortOrder: v.optional(v.number()),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db
      .query('segmentTemplates')
      .withIndex('by_sort_order')
      .collect();

    return templates.map(template => ({
      id: template.templateId,
      label: template.label,
      type: template.type,
      introSounder: template.introSounder,
      outroSounder: template.outroSounder,
      sortOrder: template.sortOrder,
    }));
  },
});

export const upsertMany = mutation({
  args: {
    adminSecret: v.string(),
    templates: v.array(segmentTemplateInput),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.adminSecret);
    for (const [index, template] of args.templates.entries()) {
      const existing = await ctx.db
        .query('segmentTemplates')
        .withIndex('by_template_id', q => q.eq('templateId', template.id))
        .unique();

      const doc = {
        templateId: template.id,
        label: template.label,
        type: template.type,
        introSounder: template.introSounder,
        outroSounder: template.outroSounder,
        sortOrder: template.sortOrder ?? index,
        updatedAt: args.updatedAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, doc);
      } else {
        await ctx.db.insert('segmentTemplates', doc);
      }
    }

    return { count: args.templates.length };
  },
});
