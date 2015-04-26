/* fornai.js
* A container for display RNA secondary structure.
*
* Author: Peter Kerpedjiev <pkerp@tbi.univie.ac.at>
* Version: 0.2
* Date: 2015-03-15
*/

function FornaContainer(element, passedOptions) {
    var self = this;

    self.options = {
        "displayAllLinks": false,
        "labelInterval": 10,
        "applyForce": true,
        "initialSize": [200,200],
        "allowPanningAndZooming": true,
        "transitionDuration": 500,
    };

    if (arguments.length > 1) {
        for (var option in passedOptions) {
            if (self.options.hasOwnProperty(option))
                self.options[option] = passedOptions[option];
        }
    }

    self.options.svgW = self.options.initialSize[0];
    self.options.svgH = self.options.initialSize[1];

    var fill = d3.scale.category20();

    // mouse event vars
    var mousedown_link = null,
        mousedown_node = null,
        mouseup_node = null;

    var xScale = d3.scale.linear()
    .domain([0,self.options.svgW]).range([0,self.options.svgW]);
    var yScale = d3.scale.linear()
    .domain([0,self.options.svgH]).range([0, self.options.svgH]);

    var graph = self.graph = {
        "nodes":[],
        "links":[]
    };
    
    self.linkStrengths = {
        "pseudoknot": 0.00,
        "protein_chain": 0.00,
        "chain_chain": 0.00,
        "intermolecule": 10.00,
        "other": 10.00
    };
    
    self.displayParameters = {
        "displayBackground": "true",
        "displayNumbering": "true",
        "displayNodeOutline": "true",
        "displayNodeLabel": "true",
        "displayLinks": "true",
        "displayPseudoknotLinks": "true",
        "displayProteinLinks": "true"
    };

    self.colorScheme = 'structure';
    self.customColors = {};
    self.animation = self.options.applyForce;
    // don't listen to events because a model window is open somewhere
    self.deaf = false;
    self.rnas = {};
    self.extraLinks = []; //store links between different RNAs


    self.createInitialLayout = function(structure, passedOptions) {
        // the default options
        var options = { 
                        'sequence': '',
                        'name': 'empty',
                        'positions': [],
                        'labelInterval': self.options.labelInterval,
                        'avoidOthers': true,
                        'uids': []
                      };

        if (arguments.length == 2) {
            for (var option in passedOptions) {
                if (options.hasOwnProperty(option))
                    options[option] = passedOptions[option];
            }
        }

        rg = new RNAGraph(options.sequence, structure, options.name);

        rnaJson = rg.recalculateElements();

        if (options.positions.length === 0) {
            // no provided positions means we need to calculate an initial layout
            options.positions = simple_xy_coordinates(rnaJson.pairtable);
        }

        rnaJson = rnaJson.elementsToJson()
        .addUids(options.uids)
        .addPositions("nucleotide", options.positions)
        .addLabels(1, options.labelInterval)
        .reinforceStems()
        .reinforceLoops()
        .connectFakeNodes()
        .reassignLinkUids();

        return rnaJson;
    };

    self.addRNA = function(structure, passedOptions) {
        var rnaJson = self.createInitialLayout(structure, passedOptions);

        if (arguments.length === 1)
            passedOptions = {};

        if ('avoidOthers' in passedOptions)
            self.addRNAJSON(rnaJson, passedOptions.avoidOthers);
        else
            self.addRNAJSON(rnaJson, true);

        return rnaJson;
    };

    self.addRNAJSON = function(rnaGraph, avoidOthers) {
        // Add an RNAGraph, which contains nodes and links as part of the
        // structure
        // Each RNA will have uid to identify it
        // when it is modified, it is replaced in the global list of RNAs
        //
        var max_x, min_x;

        if (avoidOthers) {
            if (self.graph.nodes.length > 0)
                max_x = d3.max(self.graph.nodes.map(function(d) { return d.x; }));
            else
                max_x = 0;

            min_x = d3.min(rnaGraph.nodes.map(function(d) { return d.x; })); 

            rnaGraph.nodes.forEach(function(node) {
                node.x += (max_x - min_x);
                node.px += (max_x - min_x);
            });
        }

        rnaGraph.nodes.forEach(function(node) {
            node.rna = rnaGraph;
        });

        self.rnas[rnaGraph.uid] = rnaGraph;
        self.recalculateGraph();

        self.update();
        self.center_view();
    };

    self.transitionRNA = function(newStructure, nextFunction) {
        //transition from an RNA which is already displayed to a new structure
        var uids = self.graph.nodes
        .filter(function(d) { return d.node_type == 'nucleotide'; })
        .map(function(d) { return d.uid; });

        var options = {"uids": uids};
        var newRNAJson = self.createInitialLayout(newStructure, options);

        var gnodes = vis_nodes.selectAll('g.gnode').data(newRNAJson.nodes, node_key);
        var duration = self.options.transitionDuration;

        console.log('duration:', duration);

        if (duration === 0)
            gnodes.attr('transform', function(d) { 
                return 'translate(' + [d.x, d.y] + ')'; });
        else
            gnodes.transition().attr('transform', function(d) { 
                return 'translate(' + [d.x, d.y] + ')'; }).duration(duration);

        var links = vis_links.selectAll("line.link").data(newRNAJson.links, link_key);
        var newNodes = self.createNewNodes(gnodes.enter())
        .attr("transform", function(d) { 
            if (typeof d.x != 'undefined' && typeof d.y != 'undefined')
                return 'translate(' + [0, 0] + ')'; 
            else
                return '';
        });

        if (duration === 0)
            gnodes.exit().remove();
        else
            gnodes.exit().transition()
            .attr("transform", function(d) { 
                if (typeof d.x != 'undefined' && typeof d.y != 'undefined')
                    return 'translate(' + [0, 0] + ')'; 
                else
                    return '';
            });

        self.graph.nodes = gnodes.data();
        self.updateStyle();
        self.center_view(duration);

        function endall(transition, callback) { 
            if (transition.size() === 0) { setTimeout(callback, duration); }
            var n = 0; 
            transition 
            .each(function() { ++n; }) 
            .each("end", function() { if (!--n) callback.apply(this, arguments); }); 
        } 

        function addNewLinks() {
            var newLinks = self.createNewLinks(links.enter());
            self.graph.links = links.data();

            self.updateStyle();

            if (typeof nextFunction != 'undefined')
                nextFunction();

        }

        links.exit().remove();

        if (duration === 0) {
            links
            .attr("x1", function(d) { return d.source.x; })
            .attr("y1", function(d) { return d.source.y; })
            .attr("x2", function(d) { return d.target.x; })
            .attr("y2", function(d) { return d.target.y; });

            var newLinks = self.createNewLinks(links.enter());
            self.graph.links = links.data();

            self.updateStyle();
        } else {
            links.transition()
            .attr("x1", function(d) { return d.source.x; })
            .attr("y1", function(d) { return d.source.y; })
            .attr("x2", function(d) { return d.target.x; })
            .attr("y2", function(d) { return d.target.y; })
            .duration(duration)
            .call(endall, addNewLinks);
        }

        if (duration === 0) {
            newNodes
            .attr("transform", function(d) { 
                if (typeof d.x != 'undefined' && typeof d.y != 'undefined')
                    return 'translate(' + [d.x, d.y] + ')'; 
                else
                    return '';
            });
        } else {
            newNodes.transition()
            .attr("transform", function(d) { 
                if (typeof d.x != 'undefined' && typeof d.y != 'undefined')
                    return 'translate(' + [d.x, d.y] + ')'; 
                else
                    return '';
            });
        }

    };

    self.recalculateGraph = function(rnaGraph) {
        // Condense all of the individual RNAs into one
        // collection of nodes and links
        self.graph.nodes = [];
        self.graph.links = [];
        for (var uid in self.rnas) {
            self.graph.nodes = self.graph.nodes.concat(self.rnas[uid].nodes);
            self.graph.links = self.graph.links.concat(self.rnas[uid].links);
        }

        // Create a lookup table so that we can access each node
        // based on its uid. This will be used to create the links
        // between different RNAs
        var uids_to_nodes = {};

        for (var i = 0; i < self.graph.nodes.length; i++)
            uids_to_nodes[self.graph.nodes[i].uid] = self.graph.nodes[i];

        self.graph.links.forEach(function(link) {
            link.source = uids_to_nodes[link.source.uid];
            link.target = uids_to_nodes[link.target.uid];
        });

        for (i = 0; i < self.extraLinks.length; i++) {
            // the actual node objects may have changed, so we hae to recreate
            // the extra links based on the uids
            self.extraLinks[i].source = uids_to_nodes[self.extraLinks[i].source.uid];
            self.extraLinks[i].target = uids_to_nodes[self.extraLinks[i].target.uid];
            
            if (self.extraLinks[i].link_type == 'intermolecule') {
                //remove links to middle nodes
                fake_links = self.graph.links.filter(function(d) { 
                    return ((d.source == self.extraLinks[i].source || d.source == self.extraLinks[i].target ||
                            d.target == self.extraLinks[i].source || d.target == self.extraLinks[i].source) &&
                            d.link_type == 'fake');
                });

                for (var j = 0; j < fake_links.length; j++) {
                    var linkIndex = self.graph.links.indexOf(fake_links[j]); 
                    self.graph.links.splice(linkIndex, 1);
                }
            }

            graph.links.push(self.extraLinks[i]);
        }
    };

    self.addNodes = function addNodes(json) {
        // add a new set of nodes from a json file

        // Resolve the sources and targets of the links so that they
        // are not just indeces into an array
        json.links.forEach(function(entry) {
            if (typeof entry.source == "number") entry.source = json.nodes[entry.source];
            if (typeof entry.target == "number") entry.target = json.nodes[entry.target];
        });

        // Get the maximum x and y values of the current graph
        // so that we don't place a new structure on top of the
        // old one
        if (self.graph.nodes.length > 0) {
            max_x = d3.max(self.graph.nodes.map(function(d) {return d.x;}));
            max_y = d3.max(self.graph.nodes.map(function(d) {return d.y;}));
        } else {
            max_x = 0;
            max_y = 0;
        }

        json.nodes.forEach(function(entry) {
            if (!(entry.rna.uid in self.rnas)) {
                self.rnas[entry.rna.uid] = entry.rna;
            }

            entry.x += max_x;
            //entry.y += max_y;

            entry.px += max_x;
            //entry.py += max_y;
        });

        r = new RNAGraph('','');
        r.nodes = json.nodes;
        r.links = json.links;

        //self.addRNA(r);
        self.recalculateGraph();

        self.update();
        self.center_view();
    };

    self.addCustomColors = function addCustomColors(json) {
        // Add a json file containing the custom colors
        self.customColors = json;
    };

    self.clearNodes = function clearNodes() {
        self.graph.nodes = [];
        self.graph.links = [];

        self.rnas = {};
        self.extraLinks = [];

        self.update();
    };
    
    self.toJSON = function toJSON() {
       var data = {"rnas": self.rnas, "extraLinks": self.extraLinks};
            var data_string = JSON.stringify(data, function(key, value) {
            //remove circular references
            if (key == 'rna') {
                return;
            } else {
                return value;
            }
       }, "\t");
       return data_string;
    };

    self.fromJSON = function(json_string) {
        var rnas, extraLinks;

        try{
            var data = JSON.parse(json_string);
            rnas = data.rnas;
            extraLinks = data.extraLinks;
        } catch(err) {
            throw err;
        }

        for (var uid in rnas) {
            if (rnas[uid].type == 'rna') {
                r = new RNAGraph();

                r.seq = rnas[uid].seq;
                r.dotbracket = rnas[uid].dotbracket;
                r.circular = rnas[uid].circular;
                r.pairtable = rnas[uid].pairtable;
                r.uid = rnas[uid].uid;
                r.struct_name = rnas[uid].struct_name;
                r.nodes = rnas[uid].nodes;
                r.links = rnas[uid].links;
                r.rnaLength = rnas[uid].rnaLength;
                r.elements = rnas[uid].elements;
                r.nucs_to_nodes = rnas[uid].nucs_to_nodes;
                r.pseudoknot_pairs = rnas[uid].pseudoknot_pairs;
            } else {
                r = new ProteinGraph();
                r.size = rnas[uid].size;
                r.nodes = rnas[uid].nodes;
                r.uid = rnas[uid].uid;
            }

            self.addRNAJSON(r, false);
        }

        extraLinks.forEach(function(link) {
            self.extraLinks.push(link);
        });

        self.recalculateGraph();
        self.update();
    };

    self.setSize = function() {
        var svgW = $(element).width();
        var svgH = $(element).height();

        self.options.svgW = svgW;
        self.options.svgH = svgH;

        //Set the output range of the scales
        xScale.range([0, svgW]).domain([0, svgW]);
        yScale.range([0, svgH]).domain([0, svgH]);

        //re-attach the scales to the zoom behaviour
        self.zoomer.x(xScale)
        .y(yScale);

        self.brusher.x(xScale)
        .y(yScale);

        //resize the background
        rect.attr("width", svgW)
        .attr("height", svgH);

        svg.attr("width", svgW)
        .attr("height", svgH);

        self.center_view();
    }

    function change_colors(molecule_colors, d, scale) {
        console.log('change_colors');
        if (molecule_colors.hasOwnProperty(d.num)) {
            val = parseFloat(molecule_colors[d.num]);

            if (isNaN(val)) {
                // passed in color is not a scalar, so 
                // treat it as a color
                return molecule_colors[d.num];
            } else {
                // the user passed in a float, let's use a colormap
                // to convert it to a color
                return scale(val);
            }
        } else {
            return 'white';
        }
    }

    self.setOutlineColor = function(color) {
        var nodes = vis_nodes.selectAll('g.gnode').select('[node_type=nucleotide]');
        nodes.style('fill', color);
    }

    self.changeColorScheme = function(newColorScheme) {
        var protein_nodes = vis_nodes.selectAll('[node_type=protein]');

        protein_nodes.classed("protein", true)
                    .attr('r', function(d) { return d.radius; });

        var gnodes = vis_nodes.selectAll('g.gnode');
        var circles = vis_nodes.selectAll('g.gnode').selectAll('circle');
        var nodes = vis_nodes.selectAll('g.gnode').select('[node_type=nucleotide]');
        self.colorScheme = newColorScheme;


        if (newColorScheme == 'sequence') {
            scale = d3.scale.ordinal()
            .range(['#dbdb8d', '#98df8a', '#ff9896', '#aec7e8', '#aec7e8'])
            .domain(['A','C','G','U','T']);
            nodes.style('fill', function(d) { 
                return scale(d.name);
            });

        } else if (newColorScheme == "structure") {
            scale = d3.scale.category10()
            .domain(['s','m','i','e','t','h','x'])
            .range(['lightgreen', '#ff9896', '#dbdb8d', 'lightsalmon',
                   'lightcyan', 'lightblue', 'transparent']);

                   nodes.style('fill', function(d) { 
                       return scale(d.elem_type);
                   });

        } else if (newColorScheme == 'positions') {
            nodes.style('fill', function(d) { 
                scale = d3.scale.linear()
                .range(["#98df8a", "#dbdb8d", "#ff9896"])
                .interpolate(d3.interpolateLab)
                .domain([1, 1 + (d.rna.rnaLength - 1) / 2, d.rna.rnaLength]);

                return scale(d.num);
            });
        } else if (newColorScheme == 'custom') {
            // scale to be used in case the user passes scalar
            // values rather than color names
            scale = d3.scale.linear()
            .interpolate(d3.interpolateLab)
            .domain(self.customColors.domain)
            .range(self.customColors.range);

            nodes.style('fill', function(d) {
                if (typeof self.customColors == 'undefined') {
                    return 'white';
                }
                
                if (self.customColors.color_values.hasOwnProperty(d.struct_name) &&
                    self.customColors.color_values[d.struct_name].hasOwnProperty(d.num)) {
                    // if a molecule name is specified, it supercedes the default colors
                    // (for which no molecule name has been specified)
                    molecule_colors = self.customColors.color_values[d.struct_name];
                    return change_colors(molecule_colors, d, scale);
                } else if (self.customColors.color_values.hasOwnProperty('')) {
                    molecule_colors = self.customColors.color_values[''];
                    return change_colors(molecule_colors, d, scale);
                }

                return 'white';
            });
        }
    };

    function mousedown() {

    }

    function mousemove() {
        if (!mousedown_node) return;

        mpos = d3.mouse(vis.node());
        // update drag line
        drag_line
        .attr("x1", mousedown_node.x)
        .attr("y1", mousedown_node.y)
        .attr("x2", mpos[0])
        .attr("y2", mpos[1]);

    }

    function mouseup() {
        if (mousedown_node) {
            drag_line
            .attr("class", "drag_line_hidden");
        }

        // clear mouse event vars
        resetMouseVars();
        //update()
    }
    //adapt size to window changes:
    window.addEventListener("resize", self.setSize, false);

    self.zoomer = d3.behavior.zoom()
        .scaleExtent([0.1,10])
        .x(xScale)
        .y(yScale)
        .on("zoomstart", zoomstart)
        .on("zoom", redraw);

    d3.select(element).select("svg").remove();

    var svg = d3.select(element)
    .attr("tabindex", 1)
    .on("keydown.brush", keydown)
    .on("keyup.brush", keyup)
    .each(function() { this.focus(); })
    .append("svg:svg")
    .attr("width", self.options.svgW)
    .attr("height", self.options.svgH)
    .attr("id", 'plotting-area');

    // set css for svg
    var style = svg.append('svg:style');
    $.get("../css/fornac.css", function(content){
        style.text(content.replace(/[\s\n]/g, ""));
    });
    
    self.options.svg = svg;

    var svg_graph = svg.append('svg:g')
    .on('mousemove', mousemove)
    .on('mousedown', mousedown)
    .on('mouseup', mouseup);

    if (self.options.allowPanningAndZooming)
        svg_graph.call(self.zoomer);

    var rect = svg_graph.append('svg:rect')
    .attr('width', self.options.svgW)
    .attr('height', self.options.svgH)
    .attr('fill', 'white')
    .attr('stroke', 'grey')
    .attr('stroke-width', 1)
    //.attr("pointer-events", "all")
    .attr("id", "zrect");

    var brush = svg_graph.append('g')
    .datum(function() { return {selected: false, previouslySelected: false}; })
    .attr("class", "brush");

    var vis = svg_graph.append("svg:g");
    var vis_links = vis.append("svg:g");
    var vis_nodes = vis.append("svg:g");

    self.brusher = d3.svg.brush()
                .x(xScale)
                .y(yScale)
               .on("brushstart", function(d) {
                   var gnodes = vis_nodes.selectAll('g.gnode').selectAll('.outline_node');
                   gnodes.each(function(d) { d.previouslySelected = ctrl_keydown && d.selected; });
               })
               .on("brush", function() {
                   var gnodes = vis_nodes.selectAll('g.gnode').selectAll('.outline_node');
                   var extent = d3.event.target.extent();

                   gnodes.classed("selected", function(d) {
                       return d.selected = self.options.applyForce && d.previouslySelected ^
                       (extent[0][0] <= d.x && d.x < extent[1][0]
                        && extent[0][1] <= d.y && d.y < extent[1][1]);
                   });
               })
               .on("brushend", function() {
                   d3.event.target.clear();
                   d3.select(this).call(d3.event.target);
               });

      brush.call(self.brusher)
          .on("mousedown.brush", null)
          .on("touchstart.brush", null) 
          .on("touchmove.brush", null)
          .on("touchend.brush", null);
      brush.select('.background').style('cursor', 'auto');

    function zoomstart() {
        var node = vis_nodes.selectAll('g.gnode').selectAll('.outline_node');
        node.each(function(d) {
                d.selected = false;
                d.previouslySelected = false;
                });
        node.classed("selected", false);
    }

    function redraw() {
        vis.attr("transform",
                 "translate(" + d3.event.translate + ")" + " scale(" + d3.event.scale + ")");
    }

    self.getBoundingBoxTransform = function() {
        // Center the view on the molecule(s) and scale it so that everything
        // fits in the window

        //no molecules, nothing to do
        if (self.graph.nodes.length === 0)
            return {'translate': [0,0], 'scale': 1};

        // Get the bounding box
        min_x = d3.min(self.graph.nodes.map(function(d) {return d.x;}));
        min_y = d3.min(self.graph.nodes.map(function(d) {return d.y;}));

        max_x = d3.max(self.graph.nodes.map(function(d) {return d.x;}));
        max_y = d3.max(self.graph.nodes.map(function(d) {return d.y;}));


        // The width and the height of the molecule
        mol_width = max_x - min_x;
        mol_height = max_y - min_y;

        // how much larger the drawing area is than the width and the height
        width_ratio = self.options.svgW / (mol_width + 1);
        height_ratio = self.options.svgH / (mol_height + 1);

        // we need to fit it in both directions, so we scale according to
        // the direction in which we need to shrink the most
        min_ratio = Math.min(width_ratio, height_ratio) * 0.8;

        // the new dimensions of the molecule
        new_mol_width = mol_width * min_ratio;
        new_mol_height = mol_height * min_ratio;

        // translate so that it's in the center of the window
        x_trans = -(min_x) * min_ratio + (self.options.svgW - new_mol_width) / 2;
        y_trans = -(min_y) * min_ratio + (self.options.svgH - new_mol_height) / 2;



        return {'translate': [x_trans, y_trans], 'scale': min_ratio};
    };

    self.center_view = function(duration) {
        if (arguments.length === 0)
            duration = 0;

        var bbTransform = self.getBoundingBoxTransform();

        if (bbTransform === null)
            return;

        // do the actual moving
        vis.transition().attr("transform",
                 "translate(" + bbTransform.translate + ")" + " scale(" + bbTransform.scale + ")").duration(duration);

        // tell the zoomer what we did so that next we zoom, it uses the
        // transformation we entered here
        self.zoomer.translate(bbTransform.translate);
        self.zoomer.scale(bbTransform.scale);
    };

    self.force = d3.layout.force()
    .charge(function(d) { if (d.node_type == 'middle')  {
            return -30; 
    }
        else 
            return -30;})
    .chargeDistance(300)
    .friction(0.35)
    .linkDistance(function(d) { return 15 * d.value; })
    .linkStrength(function(d) { if (d.link_type in self.linkStrengths) {
                                  return self.linkStrengths[d.link_type];
                                } else {
                                  return self.linkStrengths.other; }
    })
    .gravity(0.000)
    .nodes(self.graph.nodes)
    .links(self.graph.links)
    .chargeDistance(110)
    .size([self.options.svgW, self.options.svgH]);

    // line displayed when dragging new nodes
    var drag_line = vis.append("line")
    .attr("class", "drag_line")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", 0);

    function resetMouseVars() {
        mousedown_node = null;
        mouseup_node = null;
        mousedown_link = null;
    }

    var shift_keydown = false;
    var ctrl_keydown = false;

    function selectedNodes(mouseDownNode) {
        var gnodes = vis_nodes.selectAll('g.gnode');

        if (ctrl_keydown) {
            return gnodes.filter(function(d) { return d.selected; });

            //return d3.selectAll('[struct_name=' + mouseDownNode.struct_name + ']');
        } else {
            return gnodes.filter(function(d) { return d.selected ; });
            //return d3.select(this);
        }
    }

    function dragstarted(d) {
        d3.event.sourceEvent.stopPropagation();

      if (!d.selected && !ctrl_keydown) {
          // if this node isn't selected, then we have to unselect every other node
            var node = vis_nodes.selectAll('g.gnode').selectAll('.outline_node');
            node.classed("selected", function(p) { return p.selected =  self.options.applyForce && (p.previouslySelected = false); })
          }

        d3.select(this).select('.outline_node').classed("selected", function(p) { d.previouslySelected = d.selected; return d.selected = self.options.applyForce && true; });

        var toDrag = selectedNodes(d);
        toDrag.each(function(d1) {
            d1.fixed |= 2;
        });

        //d3.event.sourceEvent.stopPropagation();
        //d3.select(self).classed("dragging", true);
        //
    }

    function dragged(d) {

        var toDrag = selectedNodes(d);

        toDrag.each(function(d1) {
            d1.x += d3.event.dx;
            d1.y += d3.event.dy;

            d1.px += d3.event.dx;
            d1.py += d3.event.dy;
        });

        self.resumeForce();
        d3.event.sourceEvent.preventDefault();
    }

    self.resumeForce = function() {
        if (self.animation)
            self.force.resume();
    };

    function dragended(d) {
        var toDrag = selectedNodes(d);

        toDrag.each(function(d1) {
            d1.fixed &= ~6;
        });
    }

    function collide(node) {
        var r = node.radius + 16,
        nx1 = node.x - r,
        nx2 = node.x + r,
        ny1 = node.y - r,
        ny2 = node.y + r;
        return function(quad, x1, y1, x2, y2) {
            if (quad.point && (quad.point !== node)) {
                var x = node.x - quad.point.x,
                y = node.y - quad.point.y,
                l = Math.sqrt(x * x + y * y),
                r = node.radius + quad.point.radius;
                if (l < r) {
                    l = (l - r) / l * 0.1;
                    node.x -= x *= l;
                    node.y -= y *= l;
                    quad.point.x += x;
                    quad.point.y += y;
                }
            }
            return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
        };
    }


    var drag = d3.behavior.drag()
    //.origin(function(d) { return d; })
    .on("dragstart", dragstarted)
    .on("drag", dragged)
    .on("dragend", dragended);

    function keydown() {
        if (self.deaf)
            // lalalalal, not listening
            return;

        if (shift_keydown) return;

        key_is_down = true;
        switch (d3.event.keyCode) {
            case 16:
                shift_keydown = true;
                break;
            case 17:
                ctrl_keydown = true;
                break;
            case 67: //c
                self.center_view();
                break;
        }

        if (shift_keydown || ctrl_keydown) {
            svg_graph.call(self.zoomer)
            .on("mousedown.zoom", null)
            .on("touchstart.zoom", null)
            .on("touchmove.zoom", null)
            .on("touchend.zoom", null);

            //svg_graph.on('zoom', null);
            vis.selectAll('g.gnode')
            .on('mousedown.drag', null);
        }

        if (ctrl_keydown) {
          brush.select('.background').style('cursor', 'crosshair');
          brush.call(self.brusher);
        }
    }

    function keyup() {
        shift_keydown = false;
        ctrl_keydown = false;

        brush.call(self.brusher)
        .on("mousedown.brush", null)
        .on("touchstart.brush", null)                                                                      
        .on("touchmove.brush", null)                                                                       
        .on("touchend.brush", null);                                                                       

        brush.select('.background').style('cursor', 'auto');
        svg_graph.call(self.zoomer);

        vis.selectAll('g.gnode')
        .call(drag);
    }

    d3.select(element)
    .on('keydown', keydown)
    .on('keyup', keyup)
    .on('contextmenu', function() {
            d3.event.preventDefault(); 
    });

    link_key = function(d) {
        return d.uid;
    };

    node_key = function(d) {
        key = d.uid;
        return key;
    };

    update_rna_graph = function(r) {
        var nucleotide_positions = r.get_positions('nucleotide');
        var label_positions = r.get_positions('label');

        var uids = r.getUids();

        r.recalculateElements()
        .elementsToJson()
        .addPseudoknots()
        .addPositions('nucleotide', nucleotide_positions)
        .addUids(uids)
        .addLabels(1, self.options.labelInterval)
        .addPositions('label', label_positions)
        .reinforceStems()
        .reinforceLoops()
        .updateLinkUids();
    };

    remove_link = function(d) {
        // remove a link between two nodes
        index = self.graph.links.indexOf(d);

        if (index > -1) {
            //remove a link
            //graph.links.splice(index, 1);

            // there should be two cases
            // 1. The link is within a single molecule

            if (d.source.rna == d.target.rna) {
                var r = d.source.rna;

                r.addPseudoknots();
                r.pairtable[d.source.num] = 0;
                r.pairtable[d.target.num] = 0;

                update_rna_graph(r);

            } else {
                // 2. The link is between two different molecules
                extraLinkIndex = self.extraLinks.indexOf(d);

                self.extraLinks.splice(extraLinkIndex, 1);
            }

            self.recalculateGraph();
        }

        self.update();
    };

    link_click = function(d) {
        if (!shift_keydown) {
            return;
        }

        var invalid_links = {'backbone': true,
                             'fake': true,
                             'fake_fake': true,
                             'label_link': true};

        if (d.link_type in invalid_links ) 
            return;

        remove_link(d);
    };


    self.add_link =  function(new_link) {
        // this means we have a new json, which means we have
        // to recalculate the structure and change the colors
        // appropriately
        //
        if (new_link.source.rna == new_link.target.rna) {
            r = new_link.source.rna;

            r.pairtable[new_link.source.num] = new_link.target.num;
            r.pairtable[new_link.target.num] = new_link.source.num;

            update_rna_graph(r);

        } else {
            //Add an extra link
            new_link.link_type = 'intermolecule';
            self.extraLinks.push(new_link);
        }
        self.recalculateGraph();
        self.update();
    };

    node_mouseclick = function(d) {
        if (d3.event.defaultPrevented) return;

        if (!ctrl_keydown) {
            //if the shift key isn't down, unselect everything
            var node = vis_nodes.selectAll('g.gnode').selectAll('.outline_node');
            node.classed("selected", function(p) { return p.selected =  self.options.applyForce && (p.previouslySelected = false); });
        }

        // always select this node
        d3.select(this).select('circle').classed("selected", d.selected = self.options.applyForce && !d.previouslySelected);
    };

    node_mouseup = function(d) {
        if (mousedown_node) {
            mouseup_node = d;

            if (mouseup_node == mousedown_node) { resetMouseVars(); return; }
            var new_link = {source: mousedown_node, target: mouseup_node, link_type: 'basepair', value: 1, uid:generateUUID()};

            for (i = 0; i < self.graph.links.length; i++) {
                if ((self.graph.links[i].source == mousedown_node)  || 
                    (self.graph.links[i].target == mousedown_node) ||
                        (self.graph.links[i].source == mouseup_node) ||
                            (self.graph.links[i].target == mouseup_node)) {

                    if (self.graph.links[i].link_type == 'basepair' || self.graph.links[i].link_type == 'pseudoknot') {
                        return;
                    }
                }

                if (((self.graph.links[i].source == mouseup_node)  && 
                     (self.graph.links[i].target == mousedown_node)) ||
                         ((self.graph.links[i].source == mousedown_node)  && 
                          (self.graph.links[i].target == mouseup_node))) {
                    if (self.graph.links[i].link_type == 'backbone') {
                        return;
                    }
                }
            }

            if (mouseup_node.node_type == 'middle' || mousedown_node.node_type == 'middle' || mouseup_node.node_type == 'label' || mousedown_node.node_type == 'label')
                return;

            self.add_link(new_link);

        }
    };

    node_mousedown = function(d) {
      if (!d.selected && !ctrl_keydown) {
          // if this node isn't selected, then we have to unselect every other node
            var node = vis_nodes.selectAll('g.gnode').selectAll('.outline_node');
            node.classed("selected", function(p) { return p.selected =  p.previouslySelected = false; })
          }


          d3.select(this).classed("selected", function(p) { d.previouslySelected = d.selected; return d.selected = self.options.applyForce && true; });

        if (!shift_keydown) {
            return;
        }

        mousedown_node = d;

        drag_line
        .attr("class", "drag_line")
        .attr("x1", mousedown_node.x)
        .attr("y1", mousedown_node.y)
        .attr("x2", mousedown_node.x)
        .attr("y2", mousedown_node.y);

        //gnodes.attr('pointer-events',  'none');

    };

    self.startAnimation = function() {
      self.animation = true;
      vis.selectAll('g.gnode')
        .call(drag);
      self.force.start();
    };
    
    self.stopAnimation = function() {
      self.animation = false;
      vis.selectAll('g.gnode')
           .on('mousedown.drag', null);
      self.force.stop();
    };
    
    self.setFriction = function(value) {
      self.force.friction(value);
      self.resumeForce();
    };

    self.setCharge = function(value) {
      self.force.charge(value);
      self.resumeForce();
    };
    
    self.setGravity = function(value) {
      self.force.gravity(value);
      self.resumeForce();
    };
    
    self.setPseudoknotStrength = function(value) {
      self.linkStrengths.pseudoknot = value;
      self.update();
    };
    
    self.displayBackground = function(value) {
      self.displayParameters.displayBackground = value;
      self.updateStyle();
    };
    
    self.displayNumbering = function(value) {
      self.displayParameters.displayNumbering = value;
      self.updateStyle();
    };

    self.displayNodeOutline = function(value) {
      self.displayParameters.displayNodeOutline = value;
      self.updateStyle();
    };
    
    self.displayNodeLabel = function(value) {
      self.displayParameters.displayNodeLabel = value;
      self.updateStyle();
    };
    
    self.displayLinks = function(value) {
      self.displayParameters.displayLinks = value;
      self.updateStyle();
    };

    self.displayPseudoknotLinks = function(value) {
      self.displayParameters.displayPseudoknotLinks = value;
      self.updateStyle();
    };

    self.displayProteinLinks = function(value) {
      self.displayParameters.displayProteinLinks = value;
      self.updateStyle();
    };
    
    self.updateStyle = function() {
        // Background
        rect.classed("transparent", !self.displayParameters.displayBackground);
        // Numbering
        vis_nodes.selectAll('[node_type=label]').classed("transparent", !self.displayParameters.displayNumbering);
        vis_nodes.selectAll('[label_type=label]').classed("transparent", !self.displayParameters.displayNumbering);
        vis_links.selectAll('[link_type=label_link]').classed("transparent", !self.displayParameters.displayNumbering);
        // Node Outline
        svg.selectAll('circle').classed("hidden_outline", !self.displayParameters.displayNodeOutline);
        // Node Labels
        vis_nodes.selectAll('[label_type=nucleotide]').classed("transparent", !self.displayParameters.displayNodeLabel);
        // Links
        svg.selectAll("[link_type=real],[link_type=basepair],[link_type=backbone],[link_type=pseudoknot],[link_type=protein_chain],[link_type=chain_chain]").classed("transparent", !self.displayParameters.displayLinks);
        // Pseudoknot Links
        svg.selectAll("[link_type=pseudoknot]").classed("transparent", !self.displayParameters.displayPseudoknotLinks);
        // Protein Links
        svg.selectAll("[link_type=protein_chain]").classed("transparent", !self.displayParameters.displayProteinLinks);
        // Fake Links
        vis_links.selectAll("[link_type=fake]").classed("transparent", !self.options.displayAllLinks);
        vis_links.selectAll("[link_type=fake_fake]").classed("transparent", !self.options.displayAllLinks);
    };

    function nudge(dx, dy) {
        node.filter(function(d) { return d.selected; })
        .attr("cx", function(d) { return d.x += dx; })
        .attr("cy", function(d) { return d.y += dy; });

        link.filter(function(d) { return d.source.selected; })
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; });

        link.filter(function(d) { return d.target.selected; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

        d3.event.preventDefault();
    }

    self.createNewLinks = function(links_enter) {
        var link_lines = links_enter.append("svg:line");

        link_lines.append("svg:title")
        .text(link_key);

        link_lines
        .classed("link", true)
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; })
        .attr("link_type", function(d) { return d.link_type; } )
        .attr("class", function(d) { return d3.select(this).attr('class') + " " + d.link_type; })
        .attr('pointer-events', function(d) { if (d.link_type == 'fake') return 'none'; else return 'all';});

        /* We don't need to update the positions of the stabilizing links */
        /*
        basepair_links = vis_links.selectAll("[link_type=basepair]");
        basepair_links.classed("basepair", true);

        fake_links = vis_links.selectAll("[link_type=fake]")
        fake_links.classed("fake", true);

        intermolecule_links = vis_links.selectAll("[link_type=intermolecule]");
        intermolecule_links.classed("intermolecule", true);

        plink = vis_links.selectAll("[link_type=protein_chain],[link_type=chain_chain]");
        plink.classed("chain_chain", true);
        */

       return link_lines;
    };

    self.createNewNodes = function(gnodes_enter) {
        gnodes_enter = gnodes_enter.append('g')
        .classed('noselect', true)
        .classed('gnode', true)
        .attr('struct_name', function(d) { return d.struct_name; })
        .attr("transform", function(d) { 
            if (typeof d.x != 'undefined' && typeof d.y != 'undefined')
                return 'translate(' + [d.x, d.y] + ')'; 
            else
                return '';
        })
        .each( function(d) { d.selected = d.previouslySelected = false; });

        gnodes_enter
        .call(drag)
        .on('mousedown', node_mousedown)
        .on('mousedrag', function(d) {})
        .on('mouseup', node_mouseup)
        .on('click', node_mouseclick)
        .transition()
        .duration(750)
        .ease("elastic")
        .attr("r", 6.5);

        // create nodes behind the circles which will serve to highlight them
        var nucleotide_nodes = gnodes_enter.filter(function(d) { 
            return d.node_type == 'nucleotide' || d.node_type == 'label' || d.node_type == 'protein';
        });

        nucleotide_nodes.append("svg:circle")
        .attr('class', "outline_node")
        .attr("r", function(d) { return d.radius+1; });

        var node = gnodes_enter.append("svg:circle")
        .attr("class", "node")
        .classed("label", function(d) { return d.node_type == 'label'; })
        .attr("r", function(d) { 
            if (d.node_type == 'middle') return 0; 
            else {
                return d.radius; 
            }
        })
        .attr("node_type", function(d) { return d.node_type; });

        var labels = gnodes_enter.append("text")
        .text(function(d) { return d.name; })
        .attr('text-anchor', 'middle')
        .attr('font-size', 8.0)
        .attr('font-weight', 'bold')
        .attr('y', 2.5)
        .attr('class', 'node-label')
        .attr("label_type", function(d) { return d.node_type; })
        .append("svg:title")
        .text(function(d) { 
            if (d.node_type == 'nucleotide') {
                return d.struct_name + ":" + d.num;
            } else {
                return '';
            }
        });

        node.append("svg:title")
        .text(function(d) { 
            if (d.node_type == 'nucleotide') {
                return d.struct_name + ":" + d.num;
            } else {
                return '';
            }
        });

        return gnodes_enter;
    };

    node_tooltip = function(d) {
        node_tooltips = {};

        node_tooltips.nucleotide = d.num;
        node_tooltips.label = '';
        node_tooltips.pseudo = '';
        node_tooltips.middle = '';
        node_tooltips.protein = d.struct_name;

        return node_tooltips[d.node_type];
    };

    self.update = function () {
        self.force.nodes(self.graph.nodes)
        .links(self.graph.links);
        
        if (self.animation) {
          self.force.start();
        }

        var all_links = vis_links.selectAll("line.link")
        .data(self.graph.links, link_key);

        all_links.attr('class', '')
        .classed('link', true)
        .attr("link_type", function(d) { return d.link_type; } )
        .attr("class", function(d) { return d3.select(this).attr('class') + " " + d.link_type; });

        var links_enter = all_links.enter();
        self.createNewLinks(links_enter);

        all_links.exit().remove();


            domain = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
            var colors = d3.scale.category10().domain(domain);

            var gnodes = vis_nodes.selectAll('g.gnode')
            .data(self.graph.nodes, node_key);
            //.attr('pointer-events', 'all');

            gnodes_enter = gnodes.enter();

            self.createNewNodes(gnodes_enter);

            gnodes.exit().remove();

            //fake_nodes = self.graph.nodes.filter(function(d) { return d.node_type == 'middle'; });
            //fake_nodes = self.graph.nodes.filter(function(d) { return true; });
            real_nodes = self.graph.nodes.filter(function(d) { return d.node_type == 'nucleotide' || d.node_type == 'label';});

            if (self.displayFakeLinks)
                xlink = all_links;
            else
                xlink = vis_links.selectAll("[link_type=real],[link_type=pseudoknot],[link_type=protein_chain],[link_type=chain_chain],[link_type=label_link],[link_type=backbone],[link_type=basepair],[link_type=fake],[link_type=intermolecule]");

            xlink.on('click', link_click);

            self.force.on("tick", function() {
                /*
                var q = d3.geom.quadtree(fake_nodes),
                i = 0,
                n = fake_nodes.length;

                while (++i < n) q.visit(collide(fake_nodes[i]));
                */

                var q = d3.geom.quadtree(real_nodes),
                i = 0,
                n = real_nodes.length;

                while (++i < n) q.visit(collide(real_nodes[i]));

                xlink.attr("x1", function(d) { return d.source.x; })
                .attr("y1", function(d) {  return d.source.y; })
                .attr("x2", function(d) { return d.target.x; })
                .attr("y2", function(d) { return d.target.y; });

                // Translate the groups
                gnodes.attr("transform", function(d) { 
                    return 'translate(' + [d.x, d.y] + ')'; 
                });
            });
            
        self.changeColorScheme(self.colorScheme);

        if (self.animation) {
          self.force.start();
        }
        
        self.updateStyle();
    };
    
    self.setSize();
}
