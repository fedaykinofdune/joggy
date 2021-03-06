var Box = require('./Box')
, EventEmitter = require('events').EventEmitter
, util = require('util')
, _ = require('underscore')
, Countdown = require('./Countdown')
, async = require('async')
, Cards = require('./Cards')
, Dealer = require('./Dealer')
, bj = require('../../../bj')
, cu = require('../../canvas')
, debug = require('debug')('joggy:Table')
, Table = module.exports = function(assets, container, user) {
    var self = this
    this.assets = assets

    this.stage = new Kinetic.Stage({
        container: container,
        width: 1000,
        height: 700
    })

    this.user = user

    this.layer = new Kinetic.Layer()
    this.stage.add(this.layer)

    // background
    this.layer.add(new Kinetic.Rect({
        id: 'background',
        width: this.stage.getWidth(),
        height: this.stage.getHeight(),
        fill: '#009900'
    }))

    cu.prepareCanvas(this.layer.getCanvas())

    this.balance = new Kinetic.Text({
        textFill: 'white',
        fontFamily: 'Arial',
        x: this.stage.getWidth() - 180,
        y: 10,
        fontSize: 18
    })
    this.layer.add(this.balance)

    this.createBoxes()
    this.createButtons()

    this.bettingTimer = new Countdown()
    this.bettingTimer.node.setAttrs({
        x: 25,
        y: 25
    })
    this.layer.add(this.bettingTimer.node)

    this.layer.draw()
}

util.inherits(Table, EventEmitter)

Table.prototype.deal = function(data, cb) {
    var self = this
    , delayBetweenCards = cb ? 200 : 0

    async.series({
        boxes1: function(next) {
            async.forEachSeries(data.boxes, function(b, next) {
                var box = self.boxes[b.index]
                box.deal()
                box.hands[0].add(b.cards[0])
                setTimeout(next, cb ? delayBetweenCards : 0)
            }, next)
        },

        dealer1: function(next) {
            self.resetDealer(data.dealer[0])
            setTimeout(next, cb ? delayBetweenCards : 0)
        },

        boxes2: function(next) {
            async.forEachSeries(data.boxes, function(b, next) {
                var box = self.boxes[b.index]
                box.hands[0].add(b.cards[1])
                setTimeout(next, cb ? delayBetweenCards : 0)
            }, next)
        },

        dealer2: function(next) {
            if (data.dealer.length >= 2) {
                return setTimeout(function() {
                    self.dealer.add(data.dealer[1])
                    next()
                }, 1000)
            }

            next()
        }
    }, cb)
}

Table.prototype.setTurn = function(turn, cb) {
    var self = this

    // remove previous active arrow
    _.each(this.boxes, function(box) {
        _.each(box.hands, function(hand) {
            if (!hand) return
            hand.setActive(false)
        })
    })

    if (turn) {
        var hand = this.boxes[turn[0]].hands[turn[1]]

        if (!hand) {
            console.error('there is no box ' + turn[0] + ' hand ' + turn[1])
            console.error('boxes are', this.boxes)
            throw new Error('hand not found, see error console')
        }

        hand.setActive(true, this.rules.decisionTime)
    }

    this.layer.draw()

    cb && cb()
}

Table.prototype.disableActions = function(cb) {
    var self = this
    _.each(['hit', 'stand', 'double', 'split'], function(n) {
        self.toggleAction(n, false)
    })
}

Table.prototype.settle = function(dealerStanding, cb) {
    var self = this
    , dealer = this.dealer ? _.pluck(this.dealer.cards, 'value') : []
    , anySettled = false

    debug('settling')

    async.parallel({
        boxes: function(next) {
            async.forEach(self.boxes, function(box, next) {
                async.forEach(box.hands, function(hand, next) {
                    if (!hand) return next()
                    if (!hand.cards) throw new Error('null cards')

                    var returned = bj.settle(
                        box.splits,
                        _.pluck(hand.cards.cards, 'value'),
                        dealer,
                        dealerStanding
                    )

                    if (returned === null) return next()

                    debug(
                        'settling box %d hand %d with %d',
                        self.boxes.indexOf(box),
                        box.hands.indexOf(hand),
                        returned
                    )

                    box.hands[box.hands.indexOf(hand)] = null

                    // take
                    if (returned === 0) {
                        return hand.bet.take(function() {
                            debug('take complete')

                            setTimeout(function() {
                                hand.discard(next)
                            }, 500)
                        })
                    }

                    // push
                    if (returned === 1) {
                        return setTimeout(function() {
                            hand.discard(next)
                        }, 2500)
                    }

                    // win
                    var pay = hand.bet.pay(hand.bet.chips * (returned - 1), function() {
                        setTimeout(function() {
                            pay.node.remove()
                            hand.discard(next)
                        }, 500)
                    })
                }, next)
            }, next)
        },

        dealer: function(next) {
            if (dealerStanding) {
                if (self.dealer) {
                    return setTimeout(function() {
                        self.dealer.discard(next)
                        self.dealer = null
                    }, 3000)
                }
            }

            next()
        }
    }, cb)
}

Table.prototype.resetDealer = function(value) {
    this.dealer && this.dealer.remove()
    this.dealer = new Dealer(this.assets, 0)

    this.dealer.node.setAttrs({
        x: 190,
        y: 20,
        name: 'dealer',
        id: 'dealer'
    })

    this.layer.add(this.dealer.node)
    this.dealer.add(value)
}

Table.prototype.discard = function(cb) {
    var self = this

    async.parallel({
        dealer: function(next) {
            self.dealer ? self.dealer.discard(next) : next()
            self.dealer = null
        },

        boxes: function(next) {
            async.forEach(self.boxes, function(box) {
                box.discard(next)
            }, next)
        }
    }, function() {
        self.dealer = null
        cb()
    })
}

Table.prototype.toggleAction = function(name, enabled) {
    this[name].setVisible(enabled)
}

Table.prototype.createButtons = function() {
    var self = this

    function createButton(attrs) {
        return new Kinetic.Text(_.extend({
            padding: 20,
            textFill: 'white',
            width: 120,
            fontFamily: 'Arial',
            align: 'center',
            stroke: 'white',
            fill: '#007700',
            fontSize: 20,
            y: self.stage.getHeight() - 80,
            visible: false
        }, attrs))
    }

    var buttonOffset = 250

    this.double = createButton({
        id: 'double',
        text: 'DOUBLE',
        x: buttonOffset,
        name: 'double',
        width: 135
    })

    this.double.on('click', function() {
        self.emit('double')
    })

    buttonOffset += this.double.getWidth()

    this.layer.add(this.double)

    this.hit = createButton({
        id: 'hit',
        text: 'HIT',
        x: buttonOffset,
        name: 'hit'
    })

    this.hit.on('click', function() {
        self.emit('hit')
    })

    buttonOffset += 120

    this.layer.add(this.hit)

    this.stand = createButton({
        id: 'stand',
        text: 'STAND',
        x: buttonOffset,
        name: 'stand'
    })

    this.stand.on('click', function() {
        self.emit('stand')
    })

    buttonOffset += 120

    this.layer.add(this.stand)

    this.split = createButton({
        id: 'split',
        text: 'SPLIT',
        x: buttonOffset,
        name: 'split'
    })

    this.split.on('click', function() {
        self.emit('split')
    })

    this.layer.add(this.split)
}

Table.prototype.createBoxes = function() {
    var self = this
    , spacer = 220
    , offset = { x: 120, y: 450 }
    , boxGrid = [
        { x: offset.x + spacer * 3, y: offset.y },
        { x: offset.x + spacer * 2, y: offset.y + 75 },
        { x: offset.x + spacer * 1, y: offset.y + 75 },
        { x: offset.x + spacer * 0, y: offset.y + 0 }
    ]

    this.boxes = _.map(_.range(4), function(bi) {
        var box = new Box(self.assets)

        box.node.on('click', function() {
            self.emit('box', { box: bi })
        })

        box.node.setX(boxGrid[bi].x)
        box.node.setY(boxGrid[bi].y)

        self.layer.add(box.node)

        return box
    })
}
