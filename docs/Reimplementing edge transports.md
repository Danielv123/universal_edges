# Reimplementing edge transports

First principes - what do we need?

Each instance must know the following:
- Edges
  - Edge origin
  - Edge length
  - Edge direction
  - Is edge ready? - Everything is set correctly on this side of the link
  - Is edge active?
    - Tracked on the controller. If both instances are `ready` and the configuration makes sense, the link is active
  - Connectors[]
    - InBelt/OutBelt/InTrain/OutTrain/InFluid/OutFluid?
    - Is blocked?

## Blocking

It is important that the origin connector gets blocked if the target is backed up or offline. For trains it must be immediately blocked as we do not want trains waiting in limbo. For chests there needs to be a buffer.

The following blocking logic applies:
- If the edge is not active, block the origin connector
- For trains:
  - When a train is sent, set the blocked status of the origin connector to 0 (for allowing a train length of 0)
  - When the train clears the destination connector, set the blocked status of the origin connector to the max train length that can be received
- For belts:
  - When an item is sent, add the amount of items sent to the blockign status of the origin connector
  - When an item is received and output, set the blocking status of the origin connector to the number of items buffered in the destination chest
  - When blocking status > buffer size, block the origin connector
- For bidirectional fluids:
  - One tank is on each side of the link with a capacity of 25k fluid. Edge transports will attempt to balance the fluid levels at ~12.5k fluid each.
  - Both tanks send their fluid capacity to the controller. The controller will send an add/subtract request to either side when it detects a sizeable imbalance.
  - There is no blocking. If the fluid is not being consumed, it will simply fill up the tanks.
- For power:
  - Same as fluids, but with a modded accumulator

## Messages

### Requests

- SetEdgeConfig - Control -> Controller

### Events

- EdgeUpdate - Controller -> Instance & Control
  - Edge config/active status has been updated
- EdgeConnectorUpdate - Instance -> Controller, Controller -> Instance
  - Controller translates InBelt -> OutBelt etc
- EdgeTransfer - Instance | Controller -> Instance (Does this allow trains to be eaten? Send trains and delay deletion?)
  - Edge ID, Type, Amount, Connector position

## Active status

The active status is key in managing edges. Generally, this is the value you want to diagnose when something is not working.

The active status is FALSE when:
- Either instance is not running
- Source and target is on the same instance

The active status is part of and synchronized with the edge config.

## Connectors

A connector is a singular link, for example a single belt running across the edge. There are different types of connectors for belts, fluids, power and trains, but they use the same code as much as possible.

### Lifecycle

## Belts

1. Belt is placed facing border
2. `edge_link_update` is sent to partner
3. Link is created on partner
4. Item enters into link, is sent to partner
5. Partner is full, sends `edge_link_update` with set_flow = false

Issues:
- Connectors can only created/removed while link is active

## Fluids

1. Pipe is placed near border
2. `edge_link_update` is sent to partner
3. Link is created on partner
4. Tank fills with fluid
5. Current fluid level is sent to partner.
   1. If partner receives higher fluid level than current, set current level to average between local level and parther level
   2. Send back amount added as amount_balanced
   3. Origin removes the amount_balanced from their storage tank

This allows for 2 way flows and makes the flow physics act pretty similar to vanilla pipes.

## Electricity transfer

### Option 1: Balancing accumulator

Simply balancing an accumulator is not sufficient since accumulators don't redsitribute. Implementing general accumulator redistribution would be expensive with a lot of solar and accumulators. One solution could be to rebalance with accumulators, then spawning a temporary generator to "drain" the accumulator when it is full.

### Option 2: bidirectional directional power transfer.

On both sides:
- A burner generator with a special energy item in it with secondary priority
- An accumulator for charge monitoring
- An EEI for consumption

If the accumulator charge + fuel in generator gets unbalanced, the EEI is activated on the side with a higher charge to refuel the generator. The generator on the lower side is always running. Fuel is capped at equivalent of X number of full accumulators.

This approach is also good because it makes it clear how much power is imported/exported in the graph.

This approach requires a mod to provide the fuel generator (unless I can figure out how to use EEI with secondary priotity maybe). It is probably not worth implementing both and mods are now low friction enough that I find this acceptble.

### Option 3: Simplify and just use a single electric energy interface

There is one electric energy interfae on either side. Lets say it holds 100 MJ. It acts like an accumulator. If there is excess power, it will charge. It has *secondary* input priority, this means it will recharge from accumulators while also having *tertiary* output priority, preventing it from recharging accumulators but allowing it to charge other edge links.

1. Substation is placed next to border
2. Electric energy interface is created on both sides of border with generation 0w usage 0w
3. generation = min(50mw, max(0, (remote - local) - 10mj))
4. comsumption = min(50mw, max(0, (local - remote) - 10mj))

usage_priority:
- solar
  - Solar panels, free power
- lamp
  - lamp
- primary-output
  - Portable fusion reactor
- primary-input
  - Personal shields
  - rocket silo
- secondary-output
  - burner-generator
  - steam-engine
  - steam-turbine
- secondary-input
  - assemblers etc
- tertiary
  - accumulator

Priority doesn't work quite right.

- When `secondary-input` it charges from accumulators
- When `secondary-output` it recharges accumulators

but I want both. I can achieve this by either usign 2 entities, or swapping the entity at some point.

1. Swap to output when above 50%, input when below 50%
2. Use one entity with output and one with input, balancing them continuously in script
   1. I think this is actually worse for performance and might mess with the graph more, so i avoid it

This is not working, we are going back to fluids with a sense loop

1. Balance EEI energy same as fluids
2. Use charge sensor accumulator to see how things are going
   1. If charge sensor < 10%, `secondary-output`
   2. If charge sensor > 10%
      1. If EEI < 50% `secondary-input`
      2. If EEI > 50% `tertiary`

## Trains

Due to their size the connector design for trains gets quite a bit more complicated. This plugin only allows unidirectional train connectors to reduce complexity.

The rail needs to approach the edge at a 90 degree angle. We measure the length of the straight rail as it approaches the edge and use that to set the max train length limit. On the other side of the edge we make an equally long rail as the arrival rail.

On the source side of the connection the rail extends past the border. There is an always red train signal on the border - this is where the train will be teleported from. Past that signal we create a row of train stops with destinations that are routable over the link. The first station will always be `edge xxx` where xxx is the ID of the link and offset is the offset of the connector.

On the destination side of the link there is a single trainstop for the train to get spawned in at. It is named `edge xxx`, this allows the train to understand that it is to continue to the next station if sent direcly to the edge stop. If it was sent to any other routable stop it is expected to be able to continue towards that stop. There is a rail signal just after the trainstop and a chain signal just before the trainstop. The chain signal is used to send the `ready` status to the source side.

### Connector lifecycle

Unlike belts, fluids and power it is harder to tie the lifecycle of the connector to the placement event of one specific entity as we are very dependant on the rail length.

A connector is created when:
- Create rail adjacent to border
- Includes all rails up to first bend, max 30 pieces
- All except the first rail piece are made invincible until the first piece is removed

Connectors cannot change length after creation.

### Blocking

Trains should only be sent if they are able to be placed on the destination. No limbo trains should ever be allowed. Duplication of trains is better than deletion.

To achieve this, the flow is as follows:

1. Train passes edge signal on the way to park at one of the stations behind it
2. When connector receives `ready` from partner (destination signal unblocked) the train is serialized and sent, but still remains in the world
3. In the partner world, the train is attempted to be deserialized. On successfull deserialization a message with edgeid, offset, complete = true is sent.
4. On receiving complete=true, the source world deletes the train.

### Serialization

We use the `universal_serializer` developed for gridworld.

### Pathfinding

The goal is for universal_edges to be used by gridworld, which aims to be fully vanilla compatible and reversible (a gridworld can be converted to a single vanilla map). To achieve this it needs to have train schedules that would work unchanged if it were running under vanilla without any edges. To do this, we need to use the vanilla pathfinder and only place/remove stations and other pathfinding penalties.

When a connection is created, the destination recursively scans connected rails for signals and stations. This results of a map of station name to lowest pathfinding penalty to reach that station. On the out of world area of the source connector we extend the rail with the following:
- A large (3000-ish) pathfinding penalty for traversing the edge
- Stations from the map