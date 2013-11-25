var listings = new Meteor.Collection("listings");
var imagesByListing = new Meteor.Collection("images-by-listing");
var listingIdsByTag = new Meteor.Collection("listing-ids-by-tag");
var bookmarksByTag = new Meteor.Collection("bookmarks-by-tag");
var games = new Meteor.Collection("games");

function escapeRegExp(string){
	return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}
// TODO: configure Etsy wrapper to use jsonp
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
	var is_touch_device = 'ontouchstart' in document.documentElement;
	jQuery(function ($) {
		if (is_touch_device) {
			$("html").addClass("touch");
		}
	});
	Handlebars.registerHelper("empty", function (data) {
		// {{#unless seems to consider [] as true, so we do this instead}}
		return data.fetch().length === 0;
	});
	Meteor.call('identify', function (err, userId) {
		Session.set("userId", userId);
	});
	Deps.autorun(function() {
		if (!Session.get("userId")) {
			return;
		}
	});
	var boardDep = new Deps.Dependency;
	Deps.autorun(function () {
		console.log("my game id is:", Session.get("gameId"));
		console.log("my game is:", games.findOne(Session.get("gameId")));
	});
	Deps.autorun(function () {
		Meteor.subscribe('open-games', Session.get('userId'));
		Meteor.subscribe('my-games', Session.get('userId'));
	});
	Template.hello.tagUserId = function () {
		var curGame = games.findOne(Session.get("gameId"));
		if (!curGame) {
			return;
		}
		return _.filter(curGame.players, function (playerId) { return playerId !== Session.get("userId"); }).pop();
	};
	Template.hello.userId = function () {
		return Session.get("userId");
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
	Template.hello.noOpenGames = function () {
	};
	Template.hello.gameId = function () {
		if (!Session.get("curChallenge")) {
			return false;
		}
		return Session.get("curChallenge").game;
	};
	Deps.autorun(function () {
		Session.set("game-ready", games.findOne({_id: Session.get("gameId"), open: false}));
	});
	Template.hello.curGame = function () {
		console.log("curgame is", games.find({_id: Session.get("gameId"), open: false}).fetch());
		return games.find({_id: Session.get("gameId"), open: false});
	};
	Template.hello.gameId = function () {
		return Session.get("gameId");
	};
	Template.hello.myOpenGames = function () {
		return games.find({open: true, "players.userId": Session.get("userId")});
	};
	Template.hello.openGames = function () {
		return games.find({open: true, "players.userId": {$ne: Session.get("userId")}}, {sort: {created: -1}, limit: 10});
	};
	Template.hello.myListings = function () {
		boardDep.depend(); // necessary?
		var board = games.findOne(Session.get("gameId"));
		if (!board) {
			return;
		}
		return _.map(_.filter(board.players,
			function (player) {return player.userId === Session.get("userId");}),
			function (player) {return player.images;})
			.pop();
	};
	Template.hello.opponentImages = function () {
		boardDep.depend(); // necessary?
		var board = games.findOne(Session.get("gameId"));
		if (!board) {
			return;
		}
		return _.map(_.filter(board.players,
			function (player) {return player.userId !== Session.get("userId");}),
			function (player) {return player.images;})
			.pop()
	};
	Template.hello.events({
		'click .leave-game' : function () {
			Meteor.call(
				"leaveAGame",
				{
					gameId: Session.get("gameId"),
					userId: Session.get("userId")
				},
				function (err, something) {
					Session.set("gameId", undefined)
				}
			);
		},
		'click .create-and-join-game' : function () {
			Meteor.call("joinAGame", {userId: Session.get("userId")}, function (err, gameId) {
				Session.set("gameId", gameId);
			});
		},
		'click .join-game' : function (e, target) {
			var game = this;
			Meteor.call("joinAGame", {gameId: game._id, userId: Session.get("userId")}, function (err, gameId) {
				Session.set("gameId", gameId);
			});
		},
		'keyup #tag-input' : function (e, target) {
			if (13 !== e.keyCode) {
				return;
			}
			Meteor.call("setPlayerTagAndLoadImagesInBoard", {
				userId: Session.get("userId"),
				tag: e.target.value,
				gameId: Session.get("gameId"),
				numImages: 9
			}, function (err, gameId) {
				if (err) {
					console.error(err);
					debugger;
				}
				boardDep.changed();
				Session.set("gameId", gameId);
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
	Meteor.publish('open-games', function (userId) {
		console.log("all games:", games.find({open:true, "players.userId": {$ne: userId}}).fetch());
		var twoMinutesAgo = new Date(new Date().getTime() - 2 * 60000);
		return games.find({open:true, created: {$gt: twoMinutesAgo}, "players.userId": {$ne: userId}}, {orderby: {created: 1}});
	});
	Meteor.publish('my-games', function (userId) {
		return games.find({"players.userId": userId});
	});
	Meteor.methods({
		identify: function () {
			return Math.random().toString();
		},
		leaveAGame: function (_args) {
			var args = _.extend({
				userId: undefined,
				gameId: undefined
			}, _args);
			console.log("removing with these args: ", args);
			games.update(args.gameId, {
				$set: {open: true},
				$pull: {players: {userId: args.userId}}
			});
			if (0 === games.findOne(args.gameId).players.length) {
				games.remove(args.gameId);
			}
		},
		joinAGame: function (_args) {
			var args = _.extend({
				userId: undefined,
				gameId: undefined
			}, _args);
			var openGameId;
			var openGame;
			if (args.gameId) {
				var openGame = games.findOne({_id: args.gameId, open: true});
				if (!openGame) {
					return false;
				}
			} else {
				var alreadyAdvertising = games.findOne({open:true, players: args.userId});
				if (alreadyAdvertising) {
					console.log(args.userId, "is are already advertising a game:", alreadyAdvertising);
					return false;
				}
			}
			if (openGame) {
				console.log("found an open game:", openGame);
				openGameId = openGame._id;
			} else {
				openGame = {
					created: new Date(),
					open: true,
					players: []
				};
				openGameId = games.insert(openGame);
				console.log("made a new game with id", openGameId);
			}
			if (-1 === _.indexOf(openGame.players, args.userId)) {
				if (openGame.players.length > 0) {
					games.update(openGameId, {$set: {open:false}});
				}
				console.log("open game before adding you = ", games.findOne(openGameId));
				console.log("putting ", args.userId, " in game ", openGameId);
				games.update(openGameId, {
					$push: {
						players: {
							userId: args.userId,
							guesses: [],
							images: []
						}
					}
				});
			} else {
				console.log("you are already in game", openGame._id);
			}
			console.log("open game after adding you = ", games.findOne(openGameId));
			return openGameId;
		},
		setPlayerTagAndLoadImagesInBoard: function (_args) {
			var args = _.extend({
				userId: undefined,
				tag: undefined,
				gameId: undefined,
				numImages: 3
			}, _args);
			var listings = Meteor.call("getListings", {
				tag: args.tag,
				numListings: args.numImages
			});
			var listingIds = [];
			var listingsById = {};
			_.each(listings, function (listing) {
				listingIds.push(listing.listing_id);
				listingsById[listing.listing_id] = listing;
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
			var gameId = args.gameId;
			if (!gameId) {
				gameId = games.insert({
					players: [ ],
					round: 0
				});
				console.log("created board with id: " + gameId);
			}
			var board = games.findOne(gameId);
			if (!board) {
				console.error("no board matching id " + gameId);
				return;
			}
			var me = _.filter(board.players, function (player) { return player.userId === args.userId; }).pop();
			if (!me) {
				me = {userId: args.userId};
				console.log("args.userId: " + args.userId);
				// console.log("the board is", board);
				board.players.push(me);
			}
			me.images = _.map(listingIds, function (listingId) {
				return imagesByListing.findOne({listing_id: listingId});
			});
			me.tag = args.tag;
			games.update({_id: board._id}, board);
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
				listing.titleUnescaped = $("<div>").html(listing.title).text();
				listings.insert(listing);
			});
			return listingInfo.results;
		}
	})
}
