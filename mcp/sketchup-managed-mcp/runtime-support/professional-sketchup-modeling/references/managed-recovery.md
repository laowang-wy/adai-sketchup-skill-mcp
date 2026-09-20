# 恢复与窗口证据

先核对用户提供的快捷方式绑定、真实进程和文档。start_local_sketchup.ps1 -CheckOnly 用于只读检查；不要为了诊断关闭未保存模型。
一次只有一个写请求。超时先 get_request_status、sketchup_project_status 并核对桥接进程；不要重放结果未知的请求。
evidence_pending → 下一步只能调 sketchup_project_retry_evidence；禁止重放建模。recovery_required 表示回滚未确认：保留检查点，先核对原请求、模型绑定与实际文档，不直接调用 recover 或重放 step。当前 recover 只接受 ready_for_step / review_required，且要求打开匹配已封存证据的检查点。不要编辑项目签名状态。
未配置窗口后端时走 Ruby 原生 capture_reference；配置 window_print 时优先窗口取证，失败记录 capture-fallback.json 并回退原生。相机/选择/窗口恢复失败时停止回退。不使用自动激活窗口/鼠标拖拽。窗口截图返回空白或错文档时必须报告失败，不能用其它截图冒充。
新机器仍需测试其驱动、渲染、2018/2019 插件和窗口取证；此包离线功能测试没有执行 SU 实机验收。
