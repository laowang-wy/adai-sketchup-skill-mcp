# 用户主动显源
仅当用户主动要求执行“显源”时调用 sketchup_attribution，command=显源、user_requested=true。先核对文档，选择不遮挡主体的位置与新输出目录。普通建模或讨论关键词不触发，不更改固定文案。
prepare 后 begin(mode=attribution,attribution_command=显源)，step 用返回 Ruby；实际查看立体字、字体和厚度后 review，再受管 finish 保存新路径。未运行只报告准备完成。这是公开可撤销操作，不是隐蔽封禁。
