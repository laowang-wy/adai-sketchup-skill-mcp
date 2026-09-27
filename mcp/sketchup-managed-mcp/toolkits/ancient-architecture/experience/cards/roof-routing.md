# 屋面方法选择

先实际看来源：脊、山面、坡面与檐环决定构造，建筑名称不决定预设。当前卡的 `methods` 来自同包真实算法；自动推送还会核对 capabilities 和 preset 参数。

通过 `sketchup_toolkit(action=invoke, operation=preset, arguments={family:roof,preset_id:所选类型})` 取得参数，按来源修改，再 `operation=compile`。两次调用带当前 project_id、toolkit_id 与 expected_fingerprint。编译已含预检；返回 `result.manifest.ruby_file` 和同目录 `mesh-data.json`。

width/depth 是檐外包，rise 是局部举高，单位 mm；绝对标高与退台是装配变换，不是 eave_height/setback 参数。当前只做屋壳可直接 step 返回 Ruby；当前做整栋主形则将各屋壳网格与主体、洞口及开敞空间共同组织。不能把一个屋壳当成整栋主形。

屋面超出预设表达范围时，直接使用受管 Ruby 或符合条件的多边形檐环曲坡 helper，不必先让预设失败。源资产复用仅限对应入口声明支持且源文件真实可达的情况。当前返回的算法名、闭合检查与历史记录都不等于建筑符合；看实际结果后先修屋形，再加表皮。
