import { z } from 'zod';
import { companyIdSchema, handler, parseBody, sanitizeText } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { answerQuestion } from '@/lib/ai/nlq';
import { query } from '@/lib/db/pool';
import { recordAudit } from '@/lib/db/repositories/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  companyId: companyIdSchema,
  question: z.string().min(2).max(500),
  conversationId: z.string().uuid().optional(),
});

/**
 * "Ask Your CFO".
 *
 * The application resolves the question against the database first; the model
 * only rewords a verified result. Numeric answers never come from model memory.
 */
export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    const { user, company } = await requireCompany(body.companyId);
    const question = sanitizeText(body.question, 500);

    const result = await answerQuestion({ companyId: company.id, question });

    const conversationId = body.conversationId ?? crypto.randomUUID();
    await query(
      `INSERT INTO chat_messages
         (company_id, user_id, conversation_id, role, content, intent, resolved_data, data_through,
          prompt_version, accounting_method)
       VALUES ($1,$2,$3,'user',$4,$5,NULL,NULL,NULL,$9),
              ($1,$2,$3,'assistant',$6,$5,$7,$8,$10,$9)`,
      [
        company.id,
        user.id,
        conversationId,
        question,
        result.intent,
        result.answer,
        JSON.stringify(result.data),
        result.dataThrough,
        result.accountingMethod,
        result.promptVersion,
      ],
    );

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: 'chat.question',
      metadata: {
        intent: result.intent,
        aiUsed: result.aiUsed,
        promptVersion: result.promptVersion,
        basis: result.accountingMethod,
        caveats: result.caveats.length,
      },
    });

    return {
      conversationId,
      answer: result.answer,
      intent: result.intent,
      data: result.data,
      dataThrough: result.dataThrough,
      source: result.source,
      basis: { method: result.accountingMethod, label: result.basisLabel },
      caveats: result.caveats,
      provenance: result.provenance.map((p) => ({
        metricKey: p.metricKey,
        label: p.label,
        value: p.value,
        formula: p.formula,
        sourceReport: p.sourceReport,
        period: p.period,
        basis: p.accountingMethod,
      })),
      aiUsed: result.aiUsed,
      promptVersion: result.promptVersion,
    };
  });
}
