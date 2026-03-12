process.stdin.setEncoding('utf8');

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', async () => {
  const payload = input ? JSON.parse(input) : {};
  const task = payload.task || {};

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const result = {
    status: 'succeeded',
    output: `Example executor completed task: ${task.title || 'Untitled task'}`,
    usage: {
      llm_cost_usd: 0.05,
      browser_seconds: 18,
      desktop_seconds: 12,
      screenshots: 1,
      retries: 0
    }
  };

  process.stdout.write(JSON.stringify(result));
});
