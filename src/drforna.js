import d3new from 'd3';
import {FornaContainer, RNAUtilities, rnaTreemap} from 'fornac';


//import dstyle from './drforna.css';

var rnaUtilities = new RNAUtilities();

export function preparePlotArea(elementName, notificationContent = 'Loading...') {
    let container = d3new.select(elementName)

    container
    .selectAll('div')
    .remove()
    // loading indicator
    container
    .style('text-align', 'center')
    .append('div')
    .attr('id', 'loadingNotification')
    .style('display', 'inline')
    .html(notificationContent)
    // treemap container
    container
    .append('div')
    .attr('id', 'visContainer')
    // table container
    container
    .append('div')
    .attr('id', 'tableContainer')
}

export function drawDrFornaContainer(elementName, drtrafoString) {
    console.log("element",elementName)
    preparePlotArea(elementName)

    let data = d3new.csvParse(drtrafoString.replace(/ +/g, ","));
    //console.log(data)
    let currentLayout = cotranscriptionalTimeSeriesLayout();

    let showPlot = () => {

      var svg = d3new.select('#visContainer')
      .data([data]).enter()
      .call(currentLayout);

      // remove loading indicator
      d3new.select(elementName)
      .select('#loadingNotification')
      .remove();

      // set callback to update table
      let tableChart = currentTimepointTable('#tableContainer')
      currentLayout 
      .newTimePointCallback(
          (d) => d3new.select('#tableContainer')
          .data([d]).enter()
          .call(tableChart)
      );
      // update current time and dimension
      currentLayout.updateDimensions();
      currentLayout.updateCurrentTime();
    }

    let setLayoutSize = () => {
        let container = d3new.select('#visContainer').node();
        let svgW = +d3new.select('#visContainer').style('width').slice(0, -2)
        //console.log(svgW)

        currentLayout.width(svgW)
        .height(500)

        currentLayout.updateDimensions();
    }

    showPlot();
    setLayoutSize();

    window.addEventListener('resize', setLayoutSize, false);
    return currentLayout;
}

export function cotranscriptionalTimeSeriesLayout() {
    var options = {
      'animation': false,
      'editable': false,
      'zoomable': false,
      'labelInterval':0,
      'transitionDuration': 0
    };

    var margin = {top: 0, right: 0, bottom: 40, left: 50};
    var isAnimating = false;
    var isPositionFrozen = false;
    var totalWidth = 700;
    var totalHeight = 400;

    let simulationTime = null;
    let sequenceLength = null;
    let occupancyTreshold = 0.01;

    var treemapWidth = totalWidth - margin.left - margin.right;
    var treemapHeight = totalHeight * 0.85 - margin.top - margin.bottom;


    var lineChartWidth = totalWidth - margin.left - margin.right;
    var lineChartHeight = totalHeight - treemapHeight - margin.top - margin.bottom;

    var lineX = d3new.scale.linear().interpolate(d3new.interpolateRound).range([0, lineChartWidth]);
    var lineY = d3new.scale.linear().interpolate(d3new.interpolateRound).range([lineChartHeight, 0]);

    var rectX = d3new.scale.linear().interpolate(d3new.interpolateRound).range([0, lineChartWidth]);
    var rectY = d3new.scale.linear().interpolate(d3new.interpolateRound).range([lineChartHeight, 0]);
    var line;

    var color = d3new.scale.category20();
    var newTimePointCallback = null;

    var treemap, wholeDiv, treemapDiv;
    var lineChartDiv, svg, currentTime = 0;

    var concProfilePaths = null;

    var gXAxis = null, gYAxis = null;
    var yAxisText = null, currentTimeIndicatorLine = null;
    var xAxis = null, yAxis = null;
    var xAxisOverlayRect = null;

    var updateTreemap = null;
    var root = null;

    var dataRectangleGroups = null;
    let maxStructLength = 0;

    function chart(selection) {
        selection.each(function(data) {
            treemap = d3new.layout.treemap()
            .size([treemapWidth, treemapHeight])
            .sticky(false)
            .value(function(d) { return d.size; });
            

            wholeDiv = d3new.select(this).append('div')
            .classed(dstyle.plot, true);
            //console.log("here",dstyle.plot)

            treemapDiv = wholeDiv.append('div')
            .classed(dstyle.treemap, true)
            .style('left', margin.left + 'px');

            /*
            labelSvg.append('text')
            .attr('transform', `translate(${margin.left - 30}, 150)rotate(-90)`)
            .text('Structures')
            */

            lineChartDiv = wholeDiv.append('div')
            .classed(dstyle.lineChart, true)
            .style('left', 0 + 'px')

            svg = lineChartDiv.append('svg')
            .attr('preserveAspectRatio', 'xMidYMid meet')
            //.attr('viewBox', '0 0 ' + lineChartWidth + ' ' + lineChartHeight)
            .attr('width', lineChartWidth)
            .attr('height', lineChartHeight)
            .append('g')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            line = d3new.svg.line()
            .interpolate('basis')
            .x(function(d) { return lineX(+d.time); })
            .y(function(d) { return lineY(+d.conc); });

            function divName(d) {
                return 'div' + d.name;
            }

            function drawCotranscriptionalLine() {
                let rainbowScale = (t) => { return d3new.hcl(t * 360, 100, 55); };
                let nucleotideScale = d3new.scale.linear()
                                          .range([0,1]);
                if (sequenceLength == null)
                    nucleotideScale.domain([0, data[data.length-1].struct.length])
                else
                    nucleotideScale.domain([0, sequenceLength]);

                calculateNucleotideColors(data);

                var dataByTime = d3new.nest().key(function(d) { return +d.time;}).entries(data);
                calculateColorPerTimePoint(dataByTime);

                color.domain(d3new.set(data.map(function(d) { return d.id })).values());

                if (simulationTime != null)
                    lineX.domain([0.1, simulationTime]);
                else
                    lineX.domain(d3new.extent(data, function(d) { return +d.time; }));

                //lineY.domain([0,data[data.length-1].struct.length]);

                xAxis = d3new.svg.axis()
                .scale(lineX)
                .orient('bottom');

                yAxis = d3new.svg.axis()
                .scale(lineY)
                .orient('left')
                .ticks(0);

                gXAxis = svg.append('g')
                .classed(dstyle.x, true)
                .classed(dstyle.axis, true)
                .call(xAxis);

                gYAxis = svg.append('g')
                .classed(dstyle.y, true)
                .classed(dstyle.axis, true)

                yAxisText = gYAxis
                .append('text')
                .attr('dy', '.71em')
                .style('text-anchor', 'middle')
                .text('Time (Seconds)');

                svg.append('g')
                .classed(dstyle.y, true)
                .classed(dstyle.axis, true)
                .attr('transform', 'translate(' + (0) + ',0)')
                .append('text')
                .attr('transform', 'translate(-25,0)rotate(-90)')
                .style('text-anchor', 'end')
                .text('Nucleotide');

                svg.append('g')
                .classed(dstyle.y, true)
                .classed(dstyle.axis, true)
                .attr('transform', 'translate(' + (0) + ',0)')

                .append('text')
                .attr('transform', 'translate(-10,5)rotate(-90)')
                .style('text-anchor', 'end')
                .text('Position');

                // here we draw a little rectangle to indicate which stem each
                // nucleotide is in at this time point

                for (let i = 0; i < dataByTime.length ; i++) {
                    dataByTime[i].dt = 0;

                    // calculate the length of each rectangle
                    if (i < dataByTime.length - 1)
                        dataByTime[i].dt = (+dataByTime[i+1].key) - (+dataByTime[i].key)

                    // the length of the simulation as well as the length of the structure
                    // after it's fully transcribed
                    maxStructLength = +dataByTime[i].values[0].struct.length;
                }

                let minTime = d3new.min(dataByTime.map((d) => { return +d.key; }));
                let maxTime = d3new.max(dataByTime.map((d) => { return +d.key; }));
                /*
                */

                rectX.domain(lineX.domain());
                rectY.domain([0, maxStructLength]);

                dataRectangleGroups = svg.selectAll('.data-rectangle-group')
                .data(dataByTime)
                .enter()
                .append('g')
                .classed('data-rectangle-group', true)
                .attr('transform', (d) => { return `translate(${rectX(+d.key)},0)`; })
                .each(function(d) {
                    let rectHeight = Math.abs(rectY.range()[1] - rectY.range()[0]) / maxStructLength;
                    let rectWidth = Math.abs(rectX(+d.key) - rectX(+d.key + d.dt));
            
                    let rectPos = rectX(+d.key);

                    d3new.select(this).selectAll('.data-rectangle')
                    .data(d.values[0].colors)
                    .enter()
                    .append('rect')
                    .classed('data-rectangle', true)
                    .attr('y', (d,i) => { return rectY(i); })
                    .attr('height', rectHeight)
                    .attr('width', rectWidth)
                    .attr('fill', (d) => {return d;});

                });

                currentTimeIndicatorLine = svg.append('line')
                .attr('x1', currentTime)
                .attr('y1', 0)
                .attr('x2', currentTime)
                .attr('y2', lineChartHeight)
                .classed(dstyle.timeIndicator, true);

                var filteredData = data.filter((d) => { return d.conc > occupancyTreshold })
                //console.log(filteredData)
                var nestedData = d3new.nest().key(function(d) { return +d.id; }).entries(filteredData)// de ce nu d.time?? 
                //console.log(nestedData)
                function createInitialRoot(nestedData) {
                    let root = {'name': 'graph',
                        'children': nestedData.map(function(d) { return {'name': d.key, 'struct':
                                                   d.values[0].struct, 'size': 1 / nestedData.length, //da, plot toate
                                                   'colors': d.values[0].colors};})};
                        
                        return root;

                }

                var concProfile = svg.selectAll('.concProfile')
                .data(nestedData)
                .enter().append('g')
                .attr('class', 'concProfile');

                root = createInitialRoot(nestedData);
                var containers = {};

                var node = treemapDiv.datum(root).selectAll('.' + dstyle.treemapNode)
                .data(treemap.nodes)
                .enter().append('div')
                .attr('class', dstyle.treemapNode)
                .attr('id', divName)
                .call(position)
                //.style('background', function(d) { return d.children ? color(d.name) : null; })
                //.text(function(d) { return d.children ? null : d.name; })
                .each(function(d) {
                   // console.log("d",d)
                    if (typeof d.struct != 'undefined') {
                        containers[divName(d)] = new FornaContainer('#' + divName(d), options);
                        // Draw initial RNA
                        //console.log('---', d.struct)
                        containers[divName(d)].transitionRNA(d.struct);
                        //containers[divName(d)].setOutlineColor(color(d.name));

                        let colorStrings = d.colors.map(function(d, i) {
                            return `${i+1}:${d}`;
                        });

                        let colorString = colorStrings.join(' ');

                        containers[divName(d)].addCustomColorsText(colorString);
                    }
                } );

                /*
                concProfilePaths = concProfile.append('path')
                .attr('class', 'line')
                .attr('d', function(d) { return line(d.values); })
                .style('stroke', function(d) {
                    return color(d.key);
                });
                */

                xAxisOverlayRect = svg.append('rect')
                .attr('class', dstyle.overlay)
                .on('mouseover', function() { })
                .on('mousemove', mousemove)
                .on('click', function() {
                    if (!isAnimating) {
                        isPositionFrozen = !isPositionFrozen;
                    }
                })

                 updateTreemap = function(root) {
                    var node = treemapDiv.datum(root).selectAll('.' + dstyle.treemapNode)
                    .data(treemap.nodes)
                    .call(position)
                }

                function calculateColorPerTimePoint(dataByTime) {
                    dataByTime.forEach((d) => {
                        d.values.sort((a,b) => { return (+b.conc) - (+a.conc); });
                    });
                }

                function calculateNucleotideColors(data) {
                    data.forEach(function(d, i) {
                        // determine the colors of each nucleotide according to the position
                        // of the stem that they're in
                        // each 'd' is a line in the dr transfomer output
                        d.time = +d.time;
                        d.conc = +d.conc;

                        // get a pairtable and a list of the secondary structure elements
                        let pt = rnaUtilities.dotbracketToPairtable(d.struct);
                        let elements = rnaUtilities.ptToElements(pt, 0, 1, pt[0], []);

                        // store the colors of each nucleotide
                        let colors = Array(pt[0]).fill(d3new.hsl("white"));

                        for (let i = 0; i < elements.length; i++) {
                            if (elements[i][0] != 's')
                                continue;     //we're not interested in anything but stems

                            // for each nucleotide in the stem
                            // assign it the stem's average nucleotide number
                            let averageBpNum = elements[i][2].reduce(
                                (a,b) => { return a+b }, 0) / elements[i][2].length;

                            // convert average nucleotide numbers to colors
                            elements[i][2].map((d) => {
                                let nucleotideNormPosition = nucleotideScale(averageBpNum);
                                colors[d-1] = rainbowScale(nucleotideNormPosition);
                            });


                            // each structure gets its own set of structures
                        }
                        d.colors = colors;
                    });
                }

                let bisectTime = d3new.bisector(function(d) { return d.time; }).left;

                function valuesAtTimePoint(time) {
                    let values = nestedData.map(function(data) {
                        let i = bisectTime(data.values, time, 0)

                        let formatColors = function(colors) {
                          return colors.map(function(c) {
                            return c.rgb().toString();
                          })
                        }
                        //console.log(i, data.values.length)
                        if ( i == 0)//original era aici si || conditia din iful de jos
                            return {'name': data.key, 'struct': data.values[0].struct, 'energy': Number(data.values[0].energy), 'colors': formatColors(data.values[0].colors), 'size': 0};
                        if ( i >= data.values.length)
                            return {'name': data.key, 'struct': data.values[0].struct, 'energy': Number(data.values[0].energy), 'colors': formatColors(data.values[0].colors), 'size':0.01};

                           
                        let sc = d3new.scale.linear()
                        .domain([data.values[i-1].time, data.values[i].time])
                        .range([data.values[i-1].conc, data.values[i].conc])
                        //console.log([data.values[i-1].conc, data.values[i].conc])

                        let value = sc(time);

                        let retVal = {'name': data.key, 'struct': data.values[i].struct, 'energy': Number(data.values[i].energy), 'colors': formatColors(data.values[i].colors), 'size': + value};

                        return retVal;
                    });

                    return values;
                }

                chart.updateCurrentTime = (xCoord = 0, animationDelay = 100) => {
                    // stop condition for animations
                    if (xCoord > lineChartWidth) {
                        isAnimating = false;
                        isPositionFrozen = false;
                        xCoord = lineChartWidth;
                    }

                    // get the interpolated concentrations at a given coordinate
                    currentTime = lineX.invert(xCoord);
                    let values = valuesAtTimePoint(currentTime);

                    values.forEach(function(v) {
                        // update container structures
                        containers[divName(v)].transitionRNA(v.struct)
                    });

                    let populatedValues = values
                    .filter(d => { return d.size > 0; })
                    .sort((a, b) => { return (b.size - a.size); });

                    if (newTimePointCallback != null)
                        newTimePointCallback({
                            'time': currentTime,
                            'values': populatedValues
                        });

                    root = {'name': 'graph',
                        'children': values };

                    updateTreemap(root);

                    currentTimeIndicatorLine.attr('x1', xCoord)
                    .attr('x2', xCoord);

                    if (isAnimating) {
                       let newChoord = xCoord + (lineChartWidth / 100);

                       if (animationDelay != 0) {
                           // next frames
                           setTimeout(() => {
                               if (isAnimating) {
                                   chart.updateCurrentTime(newChoord, animationDelay);
                               }
                           }, animationDelay);
                       } else {
                           // only show one next frame
                           isAnimating = false;
                           chart.updateCurrentTime(newChoord, animationDelay);
                       }

                    }
                }

                chart.toggleAnimation = (delay = 100, fromStart = false) => {
                    isAnimating = !isAnimating;
                    if (isAnimating) {
                        let coord = +currentTimeIndicatorLine.attr('x1')
                        if (fromStart) {
                            coord = 0
                        }
                        chart.updateCurrentTime(coord, delay);
                    }
                }

                function mousemove() {
                    if (!(isAnimating || isPositionFrozen)) {
                        chart.updateCurrentTime(d3new.mouse(this)[0]);
                    }
                }
            };


            drawCotranscriptionalLine();

            function position() {
              this.style('left', function(d) {  return d.x + 'px'; })
                  .style('top', function(d) { return d.y + 'px'; })
                  .style('width', function(d) {
                    if (d.dy == 0 || d.dx < 10) {
                      return '0px';
                    } else {
                      return Math.max(0, d.dx) + 'px';
                    }
                  })
                  .style('height', function(d) {
                    if (d.dx == 0 || d.dy < 10) {
                      return '0px';
                    } else {
                      return Math.max(0, d.dy) + 'px';
                    }
                  })
            }
        });

        chart.updateDimensions();
    }

    chart.updateDimensions = function() {
        treemapWidth = totalWidth - margin.left - margin.right;
        treemapHeight = totalHeight * 0.85 - margin.top - margin.bottom;

        lineChartHeight = totalHeight - treemapHeight - margin.top - margin.bottom;

        lineChartWidth = totalWidth - margin.left - margin.right;
        lineChartHeight = totalHeight - treemapHeight - margin.top - margin.bottom;

        lineX = lineX.range([0, lineChartWidth]);
        lineY = lineY.range([lineChartHeight, 0]);

        rectX.range([0, lineChartWidth]);
        rectY.range([lineChartHeight, 0]);

        wholeDiv
        .style('width', (treemapWidth + margin.left + margin.right) + 'px')
        .style('height', (treemapHeight + lineChartHeight + margin.top + margin.bottom) + 'px')

        treemapDiv
            .style('width', (treemapWidth) + 'px')
            .style('height', (treemapHeight) + 'px')

        lineChartDiv
            .style('width', (lineChartWidth + margin.left) + 'px')
            .style('height', (lineChartHeight + margin.bottom + margin.top) + 'px')
            .style('top', treemapHeight + 'px');

        lineChartDiv.select('svg')
            .attr('width', lineChartWidth)
            .attr('height', lineChartHeight)

        line
            .x(function(d) { return lineX(+d.time); })
            .y(function(d) { return lineY(+d.conc); });

        if (gXAxis != null)
            gXAxis
                .attr('transform', 'translate(0,' + lineChartHeight + ')')

        if (gYAxis != null)
            gYAxis
                .attr('transform', 'translate(' + (0) + ',0)')

        if (xAxis != null) {
            xAxis.scale(lineX)

            gXAxis.call(xAxis);
        }

        if (yAxis != null) {
            yAxis.scale(lineY)

            // here is where we draw the y - axis
            gYAxis.call(yAxis)
        }

        if (xAxisOverlayRect != null)
            xAxisOverlayRect
                .attr('width', lineChartWidth)
                .attr('height', lineChartHeight)

        if (concProfilePaths != null)
            concProfilePaths
            .attr('d', function(d) { return line(d.values); })

        if (dataRectangleGroups != null) {
            dataRectangleGroups
                .attr('transform', (d) => { return `translate(${rectX(+d.key)},0)`; })

            dataRectangleGroups.each(function(d) {
                let rectWidth = Math.abs(rectX(+d.key) - rectX(+d.key + d.dt));
                let rectPos = rectX(+d.key);

                d3new.select(this).selectAll('.data-rectangle')
                    .attr('y', (d,i) => { return rectY(i); })
                    .attr('height', Math.abs(rectY.range()[1] - rectY.range()[0]) / maxStructLength)
                    .attr('width', rectWidth);
            });
        }


        if (yAxisText != null)
            yAxisText
                .attr('x', lineChartWidth /2)
                .attr('y', lineChartHeight + 25)

        if (currentTimeIndicatorLine != null)
            currentTimeIndicatorLine
            .attr('y2', lineChartHeight)

        treemap.size([treemapWidth, treemapHeight])

        if (updateTreemap != null)
            updateTreemap(root)
    }

    chart.width = function(_) {
        if (!arguments.length) return totalWidth;
        else totalWidth = _;
        return chart;
    };

    chart.height = function(_) {
        if (!arguments.length) return totalHeight;
        else totalHeight = _;
        return chart;
    };

    chart.newTimePointCallback = function(_) {
        if (!arguments.length) return options.newTimePointCallback;
        else newTimePointCallback = _;
        return chart;
    }

    chart.margin = function(_) {
        return margin;
    }

    chart.isAnimating = function(_) {
        return isAnimating;
    }

    chart.occupancyTreshold = function(_) {
      if (!arguments.length) return occupancyTreshold;
      else occupancyTreshold = _;
      return chart;
    }

    chart.simulationTime = function(_) {
        if (!arguments.length) return simulationTime;
        else simulationTime = _;
        return chart;
    }

    chart.sequenceLength = function(_) {
        if (!arguments.length) return sequenceLength;
        else sequenceLength = _;
        return chart;
    }

    return chart;
}

export function currentTimepointTable(element) {
  var columns = ['name', 'struct', 'size', 'energy'];
  var colnames = ['ID', 'Structure', 'Occupancy', 'Energy'];


  d3new.select(element).selectAll('table').remove()
  var table = d3new.select(element)
              .append('table')
              .classed(dstyle.timePointTable, true)
  var thead = table.append('thead')
  var tbody = table.append('tbody')

  // append the header row
  thead.append('tr')
    .selectAll('th')
    .data(colnames).enter()
    .append('th')
    .text(function (column) { return column; });

  let drawStructure = function(data, i) {
    let elem = d3new.select(this)
    elem.selectAll('span').remove()
    for (let i = 0; i < data.value.length; i++) {

      elem.append('span')
      .style('background-color', data.colors[i])
      .text((d) => data.value[i])
    }
  }

  function chart(selection) {
    selection.each(function(data) {
      // create a row for each object in the data
      let rows = tbody.selectAll('tr')
      .data(data.values)

      rows.enter()
      .append('tr')
      rows.exit()
      .remove()

      // create a cell in each row for each column
      var cells = tbody.selectAll('tr').selectAll('td')
        .data((row) => {
          return columns.map((column) => {
            let rowData = { column: column, value: row[column] }
            if (column == 'struct') {
              rowData.colors = row['colors']
            }
            return rowData;
          });
        })

        cells.enter()
        .append('td')
        .attr('class', (d) => { return dstyle['table' + d.column]; })
        cells.exit().remove()
        cells.text((d) => { if (!isNaN(d.value)) { return Math.round(d.value * 100) / 100; }});

        cells.filter((d) => { return d.column == 'struct' })
        .each(drawStructure)
    })
  }
  return chart
}

export function cotranscriptionalSmallMultiplesLayout() {
    // set all of the parameters
    var padding = [10,10];
    var treemapWidth = 160;
    var treemapHeight = 160;
    var svgWidth = 550;
    var svgHeight = 0;
    var textHeight = 15;

    function getOrCreateSequence(cotranscriptionalState) {
        // extract the sequence from a line of coTranscriptional output
        // and if it doesn't exist (which it shouldn't), just return
        // a string of Ns
        let letters;
        if ('seq' in cotranscriptionalState)
            return cotranscriptionalState['seq']
        else {
            letters = '';
            for (let i = 0; i < cotranscriptionalState['struct'].length; i++)
                letters = letters + 'N';
        }

        return letters;
    };

    var chart = function(selection) {
        selection.each(function(data) {

            var nestedData = d3new.nest().key(function(d) { return d.time; }).entries(data);
            nestedData.sort(function(a,b) { return (+a.key) - (+b.key); });

            var inputData = nestedData.map(function(x) {
                return {
                    'children': x.values.map(function(y) {
                        return {
                            'structure': y.struct,
                            'sequence': getOrCreateSequence(y),
                            'size': y.conc,
                            'time': y.time
                        };
                    })
                }});

            // calculate the number of columns and the height of the SVG,
            // which is dependent on the on the number of data points
            var numCols = Math.floor((svgWidth + padding[0]) / (treemapWidth + padding[0]));
            var svgHeight = Math.ceil(inputData.length / numCols) * (treemapHeight + padding[1]) - padding[1];

            // the rna treemap layout, which will be called for every grid point
            var rnaTreemapChart = rnaTreemap()
            .width(treemapWidth)
            .height(treemapHeight - textHeight)

            // the grid layout that will determine the position of each
            // treemap
            var rectGrid = d3new.layout.grid()
            .bands()
            .size([svgWidth, svgHeight])
            .cols(numCols)
            .padding(padding)
            .nodeSize([treemapWidth, treemapHeight]);
            var rectData = rectGrid(inputData)
                .map(function(d) {
                    d.pos = { x: d.x, y: d.y }
                    return d;
                });

            // create an svg as a child of the #rna_ss div
            // and then a g for each grid cell
            var svg = d3new.select(this)
            .append('svg')
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .attr('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight)

            svg.selectAll('.rna-treemap')
            .data(rectData)
            .enter()
            .append('g')
            .attr('transform', function(d) {
                return 'translate(' + d.x + ',' + d.y + ')'; })
            .classed('rna-treemap', true)
            .call(rnaTreemapChart);

            svg.selectAll('.time-g')
            .data(rectData)
            .enter()
            .append('g')
            .attr('transform', function(d) {
                return 'translate(' + d.pos.x + ',' + d.pos.y + ')'; })
            .classed('time-g', true)
            .append('text')
            .attr('x', treemapWidth / 2)
            .attr('y', treemapHeight - textHeight + 16)
            .classed(dstyle.timeLabel, true)
            .text(function(d) {
                  return 'time: ' + d.children[0].time
            });
        });
    };

    chart.width = function(_) {
        if (!arguments.length) return svgWidth;
        else svgWidth = _;
        return chart;
    }

    chart.height = function(_) {
        if (!arguments.length) return svgHeight;
        return chart;
    }


    return chart;
}
