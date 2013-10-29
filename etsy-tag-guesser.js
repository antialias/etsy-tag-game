var listings = new Meteor.Collection("listings");
var imagesByListing = new Meteor.Collection("images-by-listing");
var listingIdsByTag = new Meteor.Collection("listing-ids-by-tag");
var bookmarksByTag = new Meteor.Collection("bookmarks-by-tag");
var imagesForChallenge = new Meteor.Collection("images-for-challenge");
var games = new Meteor.Collection("games");

function escapeRegExp(string){
	return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}
var Etsy = function (_props) {
	this.props = _.extend({
		api_key: undefined,
		base: undefined
	}, _props);
};
Etsy.prototype.get = function (call, params, callback) {
	return HTTP.get(this.props.base + call, {
		params: _.extend({
			api_key: this.props.api_key
		}, params)
	}, callback);
};
var etsy = new Etsy({
	base: "https://openapi.etsy.com/v2/",
	api_key: "pufm9q47614yg1l5iyiv1z90"
});
if (Meteor.isClient) {
	Meteor.call('identify', function (err, userId) {
		Session.set("userId", userId);
	});
	var boardDep = new Deps.Dependency;
	// TODO: configure Etsy wrapper to use jsonp
	var getOpenGame = function () {
		var userId = Session.get("userId");
		var curGame = games.findOne({open:true});
		if (curGame) {
			return curGame;
		}
		curGame = {
			_id: new Date().getTime().toString(),
			open:true,
			players: {}
		}
		games.insert(curGame);
		return curGame;
	};
	Template.hello.gameId = function () {
		if (!Session.get("curChallenge")) {
			return false;
		}
		return Session.get("curChallenge").game;
	};
	Template.hello.tagUserId = function () {
		var curChallenge = Session.get("curChallenge");
		if (!curChallenge) {
			return false;
		}
		var curGame = games.findOne({_id: Session.get("curChallenge").game});
		if (!curGame) {
			console.log("there is no record of the current game (id " + Session.get("curChallenge").game + ")");
			return;
		}
		return _.filter(
			curGame.players,
			function (playerId) {
				return playerId !== Session.get("userId");
			}
		)[0];
	};
	Template.hello.userId = function () {
		return Session.get("userId");
	};
	Template.hello.myRound = function () {
		return Session.get("myRound");
	};
	Template.hello.opponentRound = function () {
		return Session.get("opponentRound");
	};
	Template.hello.tag = function () {
		return Session.get("tag");
	};
	// Template.hello.otherListings = function () {
	// 	if (!Session.get("tag")) {
	// 		return [];
	// 	}
	// 	var latestTag = listingIdsByTag.findOne({userId: {$not: Session.get("tag")}}, {sort:{date:-1}});
	// 	console.log("latestTag", latestTag);
	// 	if (!latestTag.tag) {
	// 		return;
	// 	}
	// 	return Meteor.call("getListings", latestTag.tag, 5);
	// };
	var opponentId = function (playerId, playersObject) {
		var opponentId;
		_.each(playersObject, function (v,k) {
			if (k !== playerId) {
				opponentId = k;
				return false;
			}
		});
		return opponentId;
	};
	Template.hello.myListings = function () {
		boardDep.depend();
		var board = imagesForChallenge.findOne({_id: Session.get("boardId")});
		if (!board) {
			return;
		}
		// TODO: determine opponent's id
		var images;
		_.each(board.players, function (player) {
			if (player.userId === Session.get("userId")) {
				images = player.images;
			}
		});
		return images;
	};
	Template.hello.opponentImages = function () {
		boardDep.depend();
		var board = imagesForChallenge.findOne({_id: Session.get("boardId")});
		if (!board) {
			return;
		}
		// TODO: determine opponent's id
		var images;
		_.each(board.players, function (player) {
			if (player.userId !== Session.get("userId")) {
				images = player.images;
			}
		});
		return images;
	};
	Template.hello.events({
		'keyup #tag-input' : function (e, target) {
			if (13 !== e.keyCode) {
				return;
			}
			Meteor.call("setPlayerTagAndLoadImagesInBoard", {
				userId: Session.get("userId"),
				tag: e.target.value,
				boardId: Session.get("boardId"),
				numImages: 3
			}, function (err, boardId) {
				if (err) {
					console.error(err);
					debugger;
				}
				boardDep.changed();
				Session.set("boardId", boardId);
			});
		}
	});
}
if (Meteor.isServer) {
	var Future = Npm.require("fibers/future")
	Meteor.startup(function () {
	});
	var nextOffset = function (_args) {
		var args = {};
		_.extend(args, {
			tag: undefined,
			count: undefined
		}, _args);
		if (!args.count) {
			console.error("nextOffset{count} is undefined");
			return undefined;
		}
		if (!args.tag) {
			console.error("nextOffset{tag} is undefined");
			return undefined;
		}
		var offsetQueryResult = bookmarksByTag.findOne({_id: args.tag});
		var offset;
		if (offsetQueryResult) {
			offset = offsetQueryResult.offset;
		} else {
			offset = 0;
			bookmarksByTag.insert({_id: args.tag, offset: offset});
		}
		bookmarksByTag.update(
			{_id: args.tag},
			{$inc: {offset: args.count}}
		);
		return offset;
	};
	Meteor.methods({
		identify: function () {
			return Math.random().toString();
		},
		setPlayerTagAndLoadImagesInBoard: function (_args) {
			var args = _.extend({
				userId: undefined,
				tag: undefined,
				boardId: undefined,
				numImages: 3
			}, _args);
			var listings = Meteor.call("getListings", {
				tag: args.tag,
				numListings: args.numImages
			});
			var listingIds = _.map(listings, function (listing) {
				return listing.listing_id;
			});
			var futures = _.map(listingIds, function (listingId) {
				// listingIdsByTag.insert({tag:tag, listing_id: listing.listing_id, date: new Date(), userId: this.userId});
				console.log("listing id", listingId);
				var future = new Future();
				var onComplete = future.resolver();
				var imageDataMaybe = imagesByListing.findOne({listing_id: listingId});
				if (imageDataMaybe) {
					onComplete(undefined, imageDataMaybe);
					console.log("we already have image data for listing with ID", listingId, imageDataMaybe);
					return future;
				}
				etsy.get("/listings/" + listingId + "/images", {}, function (error, response) {
					if (error) {
						console.error("error response from etsy", arguments);
						return;
					}
					if (200 !== response.statusCode) {
						return;
					}
					var imageResponse = JSON.parse(response.content);
					// console.log(imageResponse);
					var i;
					console.log("got " + imageResponse.results.length + " images for listing with id " + listingId);
					_.each(imageResponse.results, function (imageData) {
						// console.log("inserting image info with listing id:", imageData.listing_id);
						imagesByListing.insert(imageData);
					});
					onComplete(error, response);
				});
				return future;
			});
			Future.wait(futures);
			var images = _.map(listingIds, function (listingId) {
				var imageForThisListing = imagesByListing.findOne({listing_id: listingId});
				console.log("imageForThisListing", listingId, imageForThisListing);
				return imageForThisListing;
			});
			var boardId = args.boardId;
			if (!boardId) {
				boardId = imagesForChallenge.insert({
					players: [ ],
					round: 0
				});
				console.log("created board with id: " + boardId);
			}
			var board = imagesForChallenge.findOne({_id: boardId});
			if (!board) {
				console.error("no board matching id " + boardId);
			}
			var me = undefined;
			_.each(board.players, function (player) {
				if (player.userId === args.userId) {
					me = player;
				}
			});
			if (!me) {
				me = {userId: args.userId};
				console.log("args.userId: " + args.userId);
				// console.log("the board is", board);
				board.players.push(me);
			}
			me.images = images;
			me.tag = args.tag;
			imagesForChallenge.update({_id: board._id}, board);
			return board._id;
		},
		getListings: function (_args) { // maybe this does not need to be a meteor method
			var args = _.extend({
				tag: undefined,
				numListings: undefined
			}, _args);
			if (bookmarksByTag.findOne({tag:args.tag, noListings: true})) {
				console.log("no reason to search again for listings with tag", args.tag);
				return [];
			}
			console.log("args.numListings: ", typeof args.numListings);
			var offset = nextOffset({tag:args.tag, count: args.numListings});
			console.log("next offset for " + args.tag + " is " + offset);
			var activeListingsForTagWithOffset = etsy.get("listings/active", {
				offset: offset,
				tags: args.tag,
				limit: args.numListings
			});
			if (activeListingsForTagWithOffset.error) {
				return false;
			}
			if (200 !== activeListingsForTagWithOffset.statusCode) {
				return false;
			}
			var listingInfo = JSON.parse(activeListingsForTagWithOffset.content)
			// console.log("listingInfo: ", listingInfo);
			if (listingInfo.count < args.numListings) {
				console.log("Reached the end of the etsy's listing list with length <= " + args.offset + " for tag " + args.tag + ".");
				if (args.offset === 0) {
					console.log("We got less than the requested " + args.numListings + " listings for tag " + args.tag + ". Try something less esoteric.");
					bookmarksByTag.update({tag: args.tag}, {noListings: true});
					return [];
				}
				console.log(" Starting back at the beginning.");
				return Meteor.call("getListings", _.extend({}, args, {offset: 0}));
			}
			console.log("we got this many back from the server: ", listingInfo.results.length);
			console.log("this many listings matched our query:", listingInfo.count);
			_.each(listingInfo.results, function (listing) {
				listings.insert(listing);
			});
			return listingInfo.results;
		}
	})
}
