importScripts('seo_article_writer_tatyana.js','chat_protocol_v94.js','service_worker.js','chat_transport_v94.js','target_tracker.js');

// Keep the public/local run requestId unchanged, but use an internal wire id whose
// literal form cannot also appear inside the normalized completion marker.
const __abhTransportAsk = askChatGPT;
askChatGPT = async function(state, prompt, requestId) {
  const wireRequestId = `wire:${String(requestId)}`;
  const wirePrompt = String(prompt).split(String(requestId)).join(wireRequestId);
  const result = await __abhTransportAsk(state, wirePrompt, wireRequestId);
  if (result && result.requestId === wireRequestId) result.requestId = requestId;
  return result;
};
