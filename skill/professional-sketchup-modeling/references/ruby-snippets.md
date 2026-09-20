# 实体引用与隔离构造

<a id="entity-lifetime"></a>
## 实体生命周期
在受管 build 的 entities 容器内创建实体；合面、推拉或擦除后旧 Face 引用可能失效，读取前检查 valid?，必要时重新获取实体。不要把不同父容器的实体用于要求共同父级的操作。组件定义使用局部坐标，实例变换只应用一次。
Ruby 示例不是生产入口；所有写入仍经 managed project step。单位从 context/API 约定核对，不能把米数直接当英寸传入。
