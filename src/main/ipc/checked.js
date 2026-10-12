// An IPC handler that only runs with what its schema accepts: the arguments after the event are parsed, and a
// refusal comes back as { ok: false, error } — the shape every Bayloob handler answers with — naming the field.
function checked(schemas, handler) {
  const list = Array.isArray(schemas) ? schemas : [schemas];
  return (event, ...args) => {
    const parsed = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i].safeParse(args[i]);
      if (!r.success) {
        const issue = r.error.issues[0];
        const where = issue?.path?.length ? issue.path.join(".") : "the request";
        return {
          ok: false,
          error: `Bayloob couldn't use what the window sent (${where}: ${issue?.message})`,
        };
      }
      parsed.push(r.data);
    }
    return handler(event, ...parsed);
  };
}

module.exports = { checked };
