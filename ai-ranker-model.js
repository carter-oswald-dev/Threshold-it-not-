/**
 * ai-ranker-model.js
 * Adapted from utils/aiRankerModel.js. This static site only needs
 * inference (loading your exported model and scoring candidates) — the
 * pairwise training loop stays in your Docker AI Trainer, unchanged.
 *
 * Your trained model is loaded from two files you export from the trainer
 * and host alongside this site: model.json + weights.bin (or *.bin shards).
 * See README.md "Publishing your trained model" for the export step.
 */

// tf is loaded globally via the CDN <script> tag in index.html
/* global tf */

const DEFAULT_MODEL_URL = './model/model.json';

export async function loadModel(modelUrl = DEFAULT_MODEL_URL) {
  try {
    const model = await tf.loadLayersModel(modelUrl);
    return model;
  } catch (e) {
    console.error('Failed to load AI ranker model from', modelUrl, e);
    return null;
  }
}

export function predictScores(model, imageFeatures, candidateFeatureList) {
  return tf.tidy(() => {
    const vecs = candidateFeatureList.map((cf) => [...imageFeatures, ...cf]);
    const input = tf.tensor2d(vecs);
    const scores = model.predict(input);
    return Array.from(scores.dataSync());
  });
}
