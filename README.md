#  AuctionHouse源码阅读

AuctionHouse一个可在链上拍卖“Non fungible”物品的平台。
“Fungible”意思是易腐的或消费品，如在商品中（水果，谷物，液体，办公用品），这些商品将被使用，然后被替换。 “Non fungible”是相反的，不易腐烂的，不可消费的。

## 1. 定义合约
1.1 Asset合约
这个合约定义了一个抽象合约，继承合约需要实现抽象合约里的两个方法，其中一个是查询方法owner，根据唯一的id返回资产的所有者；
另一个方法是setOwner用于设置新的资产所有者，既然在链上拍卖物品，拍卖成功后资产自然易主，所以需要提供一个易主方法。
```
contract Asset {
    function owner(string _recordId) returns (address ownerAddress);
    function setOwner(string _recordId, address _newOwner) returns (bool success);    
}
```

1.2 SampleName合约
“Non fungible”商品的一个示例合约，提到“Non fungible”资产，每个都是独一无二的，没有“balance”这个概念。每个资产有一个唯一的ID及一些附加的元数据，这个示例合约的灵感来源于ERC137。
这个合约继承自Asset这个抽象合约，需要实现owner和setOwner方法。合约中有一个Map类型的records，通过唯一的recordId指向一个Record（结构体）对象。通过addRecord方法可以增加记录，增加记录时需要传入一个唯一的recordId值及一些附加的记录数据，只有recordId对应的记录不存在时才创建新的Record对象，否则直接返回false。Record对象中有一个钱包地址，合约提供了更新及查询这个钱包地址的方法。另外，这个合约定义了一个modifier，限制只有资产所有者才能进行某些操作。
在这个合约中提供了增加了记录的方法，可以通过传入一个唯一的名称（recordId）然后建立一个指向Record的对象，代表了这个资产相关的东西。
```
function addRecord(string _recordId, address _owner, string _name, address _walletAddress) returns (bool sufficient) {
    if (records[_recordId].owner != 0) {
        // If a record with this name already exists
        return false;
    }

    Record r = records[_recordId];

    r.owner = _owner;
    r.name = _name;
    r.walletAddress = _walletAddress;

    return true;
}
```
1.3 AuctionHouse合约
拍卖合约，我们这个合约分为几个部分：
1） 变量定义
- 一个Auction数组，Auction是一个结构体，由以下属性组成：
```
struct Auction {
    // Location and ownership information of the item for sale
    address seller; // 资产拍卖者
    address contractAddress; // 资产的地址（资产合约的地址）
    string recordId;         // 资产唯一的ID
    // Auction metadata
    string title; // 拍卖的title
    string description;      // 拍卖的描述
    uint blockNumberOfDeadline; // 拍卖的有效期，以block块计，即在新产生多少个blocks之后，这个拍卖结束
    AuctionStatus status; // 拍卖的状态
    // Distribution bonus
    uint distributionCut;    // 手续费比例，按百分比算
    address distributionAddress; // 手续费收款地址
    // Pricing in wei
    uint256 startingPrice;   // 起始价
    uint256 reservePrice; // 保底价
    uint256 currentBid; // 当前拍价
    Bid[] bids; // 竞拍信息
}
```
Auction结构体有一个Bid数组，保存这个拍卖的所有竞拍信息，Bid也是一个结构，包含以下属性：
```
struct Bid {
    address bidder; // 竞拍者
    uint256 amount; // 竞拍价
    uint timestamp; // 竞拍的时间
}
```
其它几个变量
```
// 用户发起拍卖的索引的集合，每个索引指向一个具体的拍卖
mapping(address => uint[]) public auctionsRunByUser; // Pointer to auctions index for auctions run by this user
// 用户发起竞拍的索引的集合，每个索引指向一个具体的拍卖
mapping(address => uint[]) public auctionsBidOnByUser; // Pointer to auctions index for auctions this user has bid on
// 某个资产是否处于拍卖状态的标识（资产合约地址+recordId唯一确认一个资产）
// 防止同一资产发起多个拍卖
mapping(string => bool) activeContractRecordConcat;
// 用户退款累积
mapping(address => uint) refunds;
```
2） events定义
events可以用于与外界通信，客户端通过监听events事件可以执行合约的状态信息。
```
event AuctionCreated(uint id, string title, uint256 startingPrice, uint256 reservePrice);
event AuctionActivated(uint id);
event AuctionCancelled(uint id);
event BidPlaced(uint auctionId, address bidder, uint256 amount);
event AuctionEndedWithWinner(uint auctionId, address winningBidder, uint256 amount);
event AuctionEndedWithoutWinner(uint auctionId, uint256 topBid, uint256 reservePrice);
event LogFailure(string message);
```
3） modifier定义
modifiers可以增加外界访问合约函数的限制。
```
modifier onlyOwner {
    if (owner != msg.sender) throw;
    _;
}

modifier onlySeller(uint auctionId) {
    if (auctions[auctionId].seller != msg.sender) throw;
    _;
}

modifier onlyLive(uint auctionId) {
    Auction a = auctions[auctionId];
    if (a.status != AuctionStatus.Active) {
        throw;
    }

    // Auction should not be over deadline
    if (block.number >= a.blockNumberOfDeadline) {
        throw;
    }
    _;
}
```
4） constructor方法
这个构造方法比较简单，只是记录合约创建者
```
// Constructor
function AuctionHouse() {
    owner = msg.sender;
}
```
5） update方法定义
- 发起（创建）一个拍卖(createAuction)： 传入拍卖资产信息（合约地址及唯一的recordId）及拍卖的信息（title等），创建一个新的拍卖，设置拍卖资产状态为true，新的拍卖的状态默认是Pening。
- 激活拍卖(activateAuction)
激活之后的拍卖才可以被竞拍，激活后拍卖状态变为Active，只有这个拍卖的所有者可以发起激活操作
- 撤销拍卖(cancelAuction)
拍卖在一定条件下可以被撤销，需要变更资产所有者，退还押金等，最后需要将拍卖设置为Inactive状态。
- 竞拍(placeBid)
拍卖在激活之后结束之前可以竞拍，每次的竞拍价要高于上一次竞拍价，且第一次的竞拍价要高于起拍价。如果此次竞拍有效，则需要将上一次的竞拍押金归还上一个竞拍用户。
- 结束拍卖(endAuction)
过了拍卖的deadline之后，就可以结束竞拍了，这时候所有人都可以结束这个拍卖（？？？？），逻辑上要区分是否有竞拍胜出者分别处理，如果有胜出者，拍卖资产易主（转给获胜者），买家和“拍卖行”（这里指的是手续费的收款地址）分钱；如果没有胜出者，拍卖资产归还卖家，押金退还，相关人员可以执行退款操作。
- 退款(withdrawRefund)
每次竞拍出价都需要缴纳等比例的押金（Ether），押金在合约账户了，如果本次竞拍成功，则需要退还上个竞拍者的押金，退还之后，可以在界面申请退款操作，押金（Ether）则从合约账户转到操作者账户上。

7） query方法定义
```
- getAuction 根据auctionId返回Auction的相关信息
- getAuctionCount 当前Auction的数量
- getStatus 根据auctionId返回返回其对应的状态
- getAuctionsCountForUser 某个用户的Auction数量
- getAuctionIdForUserAndIdx 根据用户和该用户Auction的索引返回auctionId
- getActiveContractRecordConcat 
- getBidCountForAuction 根据auctionId返回Auction的竞拍数
- getBidForAuctionByIdx 根据auctionId和bidIndex查询Bid信息
- getRefundValue 查询某一用户该退款的数量
```
8） helper方法（内部方法使用）
```
- partyOwnsAsset 判断资产是否属于某个当事人
- strConcat 拼接两个字符串
- addrToString 地址转string
```
9） 特殊方法

这是一个[Fallback Function](http://solidity.readthedocs.io/en/develop/contracts.html#fallback-function)：
```
function() {
    // Don't allow ether to be sent blindly to this contract
    throw;
}
```

## 2 前端交互
2.1 metamask

2.2 创建Auction

2.3 激活Auction

2.4 竞拍

## 3 运行测试
3.1 安装truffle（这里要注意一下版本）
```
npm install -g truffle@3.2.1
```
注： 如果是比较新的版本，运行truffle serve会报错

3.2 安装builder
```
npm install truffle-default-builder --save
```
3.3 编译contract
```
truffle compile
```
3.4 部署compact
```
truffle migrate
```

注1： 在部署之前，先启动testrpc

注2： 部署之后会返回合约的部署地址，需要将这两个地址更新到network.js中

3.5 启动程序
```
truffle server
```
3.6 在浏览器访问
```
http://localhost:8080
```

## 4 声明
这个项目目前还处于开发阶段，很多功能不完善（很久没有提交了），请不要直接用于生产。
但可以做为参考学习如何用Solidity编写和部署合约，以及如何使用web3在前端和合约交互。