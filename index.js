import express from "express";
import { Octokit } from "@octokit/core";
import OpenAI from "openai";


const app = express();
app.use(express.json());

const port = Number(process.env.PORT || "3000");

// 呼び出し可能な関数の定義 (Function Calling用)
const WEATHER_FUNCTION = {
  name: "getWeather",
  description: "指定した都市の現在の天気情報を取得します。",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "天気を知りたい都市の名前" },
    },
    required: ["city"],
  },
};

// 固定の天気予報データを返すサンプル関数 (実際にはAPIを呼び出します)
async function getWeather(city) {
  return {
    city,
    description: "晴れ",
    temperature: 22,
  };
}

app.get("/", (req, res) => {
  res.send("ようこそ、ブラックビアード海賊 GitHub Copilot 拡張機能へ！");
});

app.post("/", async (req, res) => {
  const tokenForUser = req.get("X-GitHub-Token");
  const octokit = new Octokit({ auth: tokenForUser });
  const user = await octokit.request("GET /user");
  const apiKey = req.headers["x-github-token"];

  const payload = req.body;
  const messages = payload.messages;

  messages.unshift({
    role: "system",
    content: `あなたはブラックビアード海賊のようにユーザー(@${user.data.login})に応答するアシスタントです。`,
  });

  const openai = new OpenAI({
    baseURL: "https://api.githubcopilot.com",
    apiKey: apiKey,
  });

  // 初回呼び出し (stream: false) でFunction Callingを検知
  const initialCompletion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools: [{ type: "function", function: WEATHER_FUNCTION }],
    tool_choice: "auto",
    stream: false,
  });

  const message = initialCompletion.choices[0].message;
  console.log("Function Calling:", message);

  // Function Callingが検出された場合の処理
  if (message.tool_calls && message.tool_calls.length > 0) {
    const functionCall = message.tool_calls[0].function;

    if (functionCall.name === "getWeather") {
      const args = JSON.parse(functionCall.arguments);  
      // 天気情報を取得するための関数を実行、結果：「晴れ」「22℃」
      const weather = await getWeather(args.city);

      // ツール呼び出しの結果をモデルに返す
      messages.push(message);
      messages.push({
        role: "tool",
        tool_call_id: message.tool_calls[0].id,
        content: JSON.stringify(weather),
      });

      // Functionの実行結果を使い最終レスポンスを生成 (stream: true)
      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        stream: true,
      });

      res.setHeader("Content-Type", "text/event-stream");

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
  }

  // Function Callingがない場合の通常応答処理
  const fallbackStream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  res.setHeader("Content-Type", "text/event-stream");

  for await (const chunk of fallbackStream) {
    res.write("data: " + JSON.stringify(chunk) + "\n\n");
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
