打包Tsdown

apikey：sk-6bd4e46135f946d38f1b18f3247dce86

baseURL：https://api.deepseek.com
model：”deepseek-v4-flash“



## 基于LoopAgentneering的Agent
Loop engineering 是指 Agent 运行循环的工程化设计，它不是写一个 while 循环那么简单，而是回答一系列关键问题。
1.什么时候调用模型？什么时候停止？
2. 工具是顺序执行还是并行执行？
3. 工具结果如何写回消息历史？
4. 顺序如何保证？
5. 如何防止无限循环？
6. 如何支持中途取消？
7. 如何将内部状态实时暴露给 UI？
8. 模型输出被截断时如何安全处理？
那么 PyAgent 的生产级 Loop 有 796 行，而最小实现只有大概 100 行。两者的核心闭环完全一致，区别在于生产版增加了流式队列、钩子、上下文变换等保护层。理解了 100 行的核心，就能够看懂 796 行中每一层复杂度解决了什么问题。