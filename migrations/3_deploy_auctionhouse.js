var AuctionHouse = artifacts.require("./AuctionHouse.sol")

module.exports = function(deployer) {
    deployer.deploy(AuctionHouse)
};
